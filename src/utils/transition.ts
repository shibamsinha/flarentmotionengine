/**
 * Scene-to-scene transitions.
 *
 * V1 cut between scenes: one block of type vanished, the next appeared. V2
 * gives the boundary a short window — 0.08s to 0.25s — in which the outgoing
 * type is still leaving while the incoming type is already arriving.
 *
 * The mechanism deliberately avoids touching the timeline. The outgoing scene's
 * exit is rendered *inside the incoming scene's own sequence*, for the first few
 * frames of it. Nothing is extended, no sequence overlaps another, and
 * `totalFrames` stays exactly `sum(round(duration × fps))`. The film is the same
 * length it always was; only what happens at the seam changes.
 *
 * Rendering the exit inside the incoming scene also settles the awkward question
 * of colour: when the field cuts at the boundary, the departing word is already
 * on the new field, so it takes the new ink and stays legible on its way out.
 *
 * WORD CONTINUITY
 * Words that appear in both scenes are not exited and re-entered. The incoming
 * copy is handed the outgoing copy's position and size, and travels from there —
 * so "YOU HAVE THE IDEA" → "YOU HAVE THE WEBSITE" slides "YOU HAVE THE" into its
 * new home rather than blinking it out and back.
 */

import type { AnimationStyle, VideoConfig } from '../types/scene';
import type { BlockLayout, PlannedWord, ScenePlan } from './plan';
import type { ExitSpec } from '../components/motion/primitives';
import { CANVAS } from './timing';
import { EXIT_EASE } from './easing';

/** Where a carried word is travelling from. */
export type CarrySource = {
  cx: number;
  cy: number;
  fontSize: number;
};

export type SceneTransition = {
  /** Frames the outgoing type gets to leave in. */
  frames: number;
  /**
   * Frames a carried word gets to travel in. Held separate from `frames`
   * because a field cut shortens the *exit* — the old words must clear fast —
   * but a word that survives the cut should still move at a readable speed
   * rather than being flung into place in two frames.
   */
  carryFrames: number;
  /** Whether the field colour cuts at this seam. */
  fieldChanges: boolean;
  /** Outgoing words that are not carried, and so must leave. */
  exiting: PlannedWord[];
  /** Incoming word id → the position and size it is arriving from. */
  carried: Map<string, CarrySource>;
  /**
   * Cross-movement: the offset a *new* incoming word enters from, opposite to
   * the direction the outgoing type is leaving in.
   *
   * Without this, a continuity seam that swaps only the hero word — "YOU HAVE
   * THE IDEA." → "YOU HAVE THE WEBSITE." — leaves both heroes sitting in the
   * same place at once, and the overlap reads as a double exposure instead of a
   * transition. Sending them opposite ways separates them for the few frames
   * they share.
   */
  cross: { x: number; y: number };
};

export const NO_TRANSITION: SceneTransition = {
  frames: 0,
  carryFrames: 0,
  fieldChanges: false,
  exiting: [],
  carried: new Map(),
  cross: { x: 0, y: 0 },
};

/**
 * Overlap length per outgoing style, in seconds.
 *
 * All well inside the 0.08–0.25s brief. RAPID is zero on purpose: it is built
 * from hard cuts, and softening its seams is the one change that would make it
 * worse rather than better.
 */
const OVERLAP_SECONDS: Record<AnimationStyle, number> = {
  massive: 0.2,
  punch: 0.16,
  stack: 0.11,
  slide: 0.22,
  // Short, but not zero. RAPID's *internal* beats stay hard cuts — this only
  // covers the hand-off out of the run, and without it the next scene opens on
  // a blank frame while its entrance fades up, which flashes.
  rapid: 0.08,
};

/**
 * How the outgoing type leaves, per style. Movement carries the transition;
 * opacity is a supporting property that trails behind it.
 *
 * SLIDE exits *against* the incoming travel so the two cross — the incoming
 * word arrives from the right as the outgoing one leaves to the left.
 */
export const exitSpecFor = (
  style: AnimationStyle,
  frames: number,
  fieldChanges = false,
  canvas: VideoConfig = CANVAS,
): Omit<ExitSpec, 'start'> => {
  const ease = EXIT_EASE[style];
  // Across a cut the word has to clear the frame in a couple of frames, so the
  // fade leads rather than trails the movement.
  const fadeEase = fieldChanges ? 'reveal' : 'exitFade';
  switch (style) {
    case 'massive':
      // Already enormous — push it past the frame instead of shrinking it away.
      return { frames, toScale: 1.42, toY: -canvas.height * 0.045, ease, fadeEase };
    case 'slide':
      // Far enough that the word is unambiguously gone rather than
      // lingering as a blurred stub at the frame edge.
      return { frames, toX: -canvas.width * 0.62, toScale: 0.97, ease, fadeEase };
    case 'stack':
      return { frames, toY: -canvas.height * 0.08, toScale: 0.94, ease, fadeEase };
    case 'rapid':
      return { frames, toScale: 1.06, ease, fadeEase };
    case 'punch':
    default:
      // Reads as the word being pushed back out of the frame it punched into.
      // The lift matters: a PUNCH exit that only scales leaves the outgoing
      // hero sitting exactly where the incoming one lands.
      return { frames, toScale: 1.12, toY: -canvas.height * 0.075, ease, fadeEase };
  }
};

/**
 * How far the incoming word comes from, as a fraction of the exit throw.
 *
 * Display type fills most of the frame, so a token offset does not separate
 * anything — the two words simply sit on top of each other. Three quarters of
 * the outgoing throw is enough for them to visibly pass.
 */
const CROSS_RATIO = 0.75;

/* ------------------------------------------------------------------ matching */

const key = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The block that is actually on screen when a scene ends.
 *
 * For RAPID that is the *last* beat, not `plan.block` — which holds the first.
 * Exiting the wrong beat would fly the opening word of the run off the screen
 * several beats after it had already gone.
 */
export const exitBlockOf = (plan: ScenePlan): BlockLayout =>
  plan.style === 'rapid' && plan.beats.length > 0
    ? plan.beats[plan.beats.length - 1].block
    : plan.block;

/** What is on screen when a scene ends. */
export type ExitPiece = {
  block: BlockLayout;
  /** The element's own style — a V3 scene may leave in several directions. */
  style: AnimationStyle;
  /** Entrance amplitude, reused so a SUPPORT line also leaves gently. */
  motion: number;
  /** The style this piece was painted in, so it leaves looking like itself. */
  visual: import('./visualStyle').VisualStyleConfig;
};

/**
 * Every block on screen at the end of a scene, each with the style it should
 * leave under.
 *
 * V2 had exactly one; a V3 scene has one per element, and they do not
 * necessarily agree — a MASSIVE hero and a PUNCH caption should not exit the
 * same way just because they share a seam.
 */
export const exitPiecesOf = (plan: ScenePlan): ExitPiece[] =>
  plan.elements.map((element) => ({
    block:
      element.style === 'rapid' && element.beats.length > 0
        ? element.beats[element.beats.length - 1].block
        : element.block,
    style: element.style,
    motion: element.motion,
    visual: element.visual,
  }));

const wordsOf = (block: BlockLayout): PlannedWord[] =>
  block.lines.flatMap((line) => line.words);

/** Every word on screen at the end of a scene, across all its elements. */
const outgoingWords = (plan: ScenePlan): PlannedWord[] =>
  exitPiecesOf(plan).flatMap((piece) => wordsOf(piece.block));

/** Every word the incoming scene will show, across all its elements. */
const incomingWords = (plan: ScenePlan): PlannedWord[] =>
  plan.elements.flatMap((element) => wordsOf(element.block));

/**
 * Pair up words that appear in both scenes.
 *
 * Matching is on the word itself, ignoring case and punctuation, first-come
 * first-served so a repeated word pairs in reading order. RAPID is excluded on
 * both sides: its layout is per-beat rather than per-scene, so there is no
 * stable thing to carry.
 */
export const planTransition = (
  from: ScenePlan | null,
  to: ScenePlan,
  fps: number,
  /**
   * True when the field colour cuts at this seam. A field change is the
   * reference's punctuation, and the outgoing word has to be re-coloured to
   * stay legible on the new field — so lingering there reads as the same words
   * inexplicably changing colour. On a cut the exit is short and fast: enough
   * for a smear that sells the movement, not enough to look like a ghost.
   */
  fieldChanges = false,
  canvas: VideoConfig = CANVAS,
): SceneTransition => {
  if (!from) return NO_TRANSITION;

  const seconds = OVERLAP_SECONDS[from.style] ?? 0.12;
  if (seconds <= 0) return NO_TRANSITION;

  // Never let the seam eat the scene. A third of the incoming scene is the
  // ceiling, so a 0.35s beat still gets most of itself to be read in.
  const carryFrames = Math.max(
    0,
    Math.min(Math.round(seconds * fps), Math.floor(to.durationInFrames * 0.34)),
  );
  const frames = fieldChanges
    ? Math.min(carryFrames, Math.round(fps * 0.1))
    : carryFrames;
  if (carryFrames < 1) return NO_TRANSITION;

  const carried = new Map<string, CarrySource>();
  const outgoing = outgoingWords(from);
  const used = new Set<string>();

  if (from.style !== 'rapid' && to.style !== 'rapid') {
    const pool = new Map<string, PlannedWord[]>();
    for (const word of outgoing) {
      const k = key(word.text);
      if (!k) continue;
      const list = pool.get(k);
      if (list) list.push(word);
      else pool.set(k, [word]);
    }

    for (const word of incomingWords(to)) {
      const k = key(word.text);
      if (!k) continue;
      const source = pool.get(k)?.shift();
      if (!source) continue;
      used.add(source.id);
      carried.set(word.id, {
        cx: source.cx,
        cy: source.cy,
        fontSize: source.fontSize,
      });
    }
  }

  // Come from the opposite side of wherever the outgoing type is headed, at a
  // fraction of the distance — enough to separate the two, not so much that the
  // incoming word reads as a second slide.
  const exit = exitSpecFor(from.style, frames, fieldChanges, canvas);
  const cross = {
    x: -(exit.toX ?? 0) * CROSS_RATIO,
    y: -(exit.toY ?? 0) * CROSS_RATIO,
  };

  return {
    frames,
    carryFrames,
    fieldChanges,
    exiting: outgoing.filter((word) => !used.has(word.id)),
    carried,
    cross,
  };
};

/**
 * The offset a carried word starts from: the delta between where it was and
 * where it now lives, expressed in the incoming word's own local space.
 *
 * Because the word is drawn inside the incoming layout and transformed about
 * its centre, matching centres and dividing the sizes is all it takes to make
 * the two positions coincide on the first frame.
 */
export const carryOffset = (
  word: PlannedWord,
  source: CarrySource,
): { x: number; y: number; scale: number } => ({
  x: source.cx - word.cx,
  y: source.cy - word.cy,
  scale: word.fontSize > 0 ? source.fontSize / word.fontSize : 1,
});
