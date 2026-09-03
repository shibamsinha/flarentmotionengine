/**
 * The scene planner.
 *
 * Turns a `Scene` into a fully resolved, measured composition: which words are
 * heroes, what size every line is, where the ink sits, and when each word
 * arrives. Motion components consume this plan — they never do layout
 * themselves, which is why adding a new style is one file.
 *
 * V3 widens the output from *one* block to a list of independently placed
 * elements. The two paths are deliberately separate:
 *
 *   scene.elements absent  → `planSingle`, the V2 planner, untouched. One block,
 *                            one hero line, support in typed order.
 *   scene.elements present → `planComposed`. Every element resolves its own
 *                            role, size and position, then the composition
 *                            places them.
 *
 * Both produce the same `ScenePlan`, and `plan.block` still points at whatever
 * dominates the frame — so transitions, field cuts and the motion styles carry
 * over without knowing V3 happened.
 *
 * This is also the seam the future AI layer plugs into: a model that emits
 * `Scene[]` gets the whole type and composition system for free.
 */

import type {
  Alignment,
  AnimationStyle,
  BackgroundName,
  CompositionPreset,
  PaletteName,
  PositionPreset,
  Scene,
  SceneElement,
  SizePreset,
  TextCase,
  TextRole,
  VideoConfig,
  WordAnimation,
} from '../types/scene';
import type { VisualStyleConfig } from './visualStyle';
import { DEFAULT_VISUAL_STYLE } from './visualStyle';
import {
  composeImage,
  typeBandHeight,
  typeCentreY,
  type ImageComposition,
} from './imageLayout';
import { CANVAS, distributeFrames, cumulative } from './timing';
import {
  ROLE_CEILING,
  ROLE_FLOOR,
  ROLE_MOTION,
  ROLE_SIZE,
  ROLE_WEIGHT,
  ROLE_WEIGHT_FACE,
  alignForAnchor,
  anchorX,
  anchorY,
  anchorsFor,
  bandCentre,
  compositionDefinition,
  layOut,
  resolveSize,
  separate,
  sizeRule,
  suggestComposition,
  type Anchors,
  type Band,
  type FlowItem,
} from './composition';
import {
  KICKER_RATIO,
  KICKER_WEIGHT,
  HERO_WEIGHT,
  LINE_GAP_EM,
  DEFAULT_PALETTE,
  SIZING,
  applyCase,
  fitToWidth,
  flipBackground,
  inkBottom,
  inkTop,
  isEmphasised,
  kickerMax,
  kickerMin,
  rapidBaseSize,
  resolveHeroSize,
  sideMargin,
  splitLines,
  splitWords,
  widthOf,
} from './typography';

export type WordRole = 'hero' | 'kicker';

export type PlannedWord = WordAnimation & {
  id: string;
  role: WordRole;
  lineIndex: number;
  /** Reveal order across the whole scene. */
  order: number;
  /** Layout position of the word inside the block, in canvas px. */
  x: number;
  y: number;
  fontSize: number;
  width: number;
  /**
   * Centre of the word's *ink* in absolute canvas coordinates. This is what
   * makes word continuity possible across a scene change: matching centres and
   * scaling between two sizes morphs a shared word from where it was to where
   * it is going, instead of replacing it.
   */
  cx: number;
  cy: number;
};

export type PlannedLine = {
  id: string;
  role: WordRole;
  text: string;
  fontSize: number;
  /** The face this line is set in. V3 uses weight as a hierarchy signal. */
  weight: number;
  align: Alignment;
  /** Top of the line box, relative to the block. */
  top: number;
  width: number;
  words: PlannedWord[];
};

export type BlockLayout = {
  lines: PlannedLine[];
  /** CSS `top` for the block so its *ink* lands where the planner put it. */
  top: number;
  /**
   * CSS `left`. V3 resolves horizontal placement in the planner rather than in
   * the renderer, because an element may sit anywhere — including off the frame
   * — and `blockLeft`'s three-way alignment cannot express that.
   */
  left: number;
  /** Height of the stacked line boxes. */
  height: number;
  /** Height of the actual ink, top of the first line to bottom of the last. */
  inkHeight: number;
  /** Offset of the ink centre from the block origin. */
  inkCentre: number;
  width: number;
  heroSize: number;
  heroLineIndex: number;
};

export type RapidBeat = {
  id: string;
  text: string;
  from: number;
  durationInFrames: number;
  background: BackgroundName;
  emphasised: boolean;
  block: BlockLayout;
};

/** One independently placed piece of type. */
export type PlannedElement = {
  id: string;
  index: number;
  role: TextRole;
  size: SizePreset;
  position: PositionPreset;
  style: AnimationStyle;
  align: Alignment;
  block: BlockLayout;
  /** RAPID elements only. */
  beats: RapidBeat[];
  /** Entrance origin offset in px, when the element enters from offscreen. */
  from?: { x: number; y: number };
  /** Frames to hold before this element enters. */
  delay: number;
  /** Entrance amplitude. EMPHASIS moves harder, SUPPORT barely moves. */
  motion: number;
  /**
   * How this element is painted, with the element's overrides already merged
   * over the scene's. Deliberately *not* resolved against a theme here: STACK
   * and RAPID cut the field mid-scene, so the ink a style resolves to depends
   * on the frame, not on the plan. `SceneRenderer` finishes the job.
   */
  visual: VisualStyleConfig;
  /**
   * Per-word colour overrides, element merged over scene, keys lower-cased.
   * Resolved here rather than in the renderer so the merge happens once per
   * plan instead of once per word per frame.
   */
  wordColors?: Record<string, string>;
  /** The element the composition is built around. */
  dominant: boolean;
};

export type ScenePlan = {
  scene: Scene;
  /** The dominant element's style. Drives field cuts and seam behaviour. */
  style: AnimationStyle;
  durationInFrames: number;
  background: BackgroundName;
  /** Where the picture sits and what room it leaves the type. */
  picture: ImageComposition;
  /** The scene's layout. */
  layout: CompositionPreset;
  /** Every piece of type in the scene, in reading order. */
  elements: PlannedElement[];
  /** The dominant element's block. What V2 called `plan.block`. */
  block: BlockLayout;
  /** The dominant element's beats. RAPID only. */
  beats: RapidBeat[];
  /** The flat, documented per-word contract. */
  words: WordAnimation[];
};

type DraftLine = {
  role: WordRole;
  words: string[];
};

/* --------------------------------------------------------------- line split */

/**
 * Newlines in the scene text are honoured as explicit line breaks, so
 *   "People\ndon't\nbuy\nWEBSITES"
 * stacks into four lines while
 *   "meant to run"  (emphasis: run)
 * becomes a "meant to" kicker over a "run" hero, exactly like the reference.
 *
 * Within a line, words are grouped into consecutive runs of the same role and
 * laid out **in the order they were typed**. Support text that came before the
 * hero sits above it; support text that came after sits below. Reading order is
 * never rearranged — "i'd tattoo" always reads "i'd" then "tattoo", no matter
 * which word is emphasised.
 *
 * This is also what the reference does without exception: "the" above "only",
 * "is who" above "you", "meant to" above "run", but "worth making" *below*
 * "comparison" — every one of them in typed order.
 */
const draftLines = (scene: Scene): DraftLine[] => {
  const sourceLines = splitLines(scene.text);
  if (sourceLines.length === 0) return [];

  const hasEmphasis = (scene.emphasis?.length ?? 0) > 0;

  if (sourceLines.length > 1) {
    const lines = sourceLines.map((line) => ({
      role: 'kicker' as WordRole,
      words: splitWords(line),
    }));
    if (hasEmphasis) {
      lines.forEach((line) => {
        if (line.words.some((word) => isEmphasised(word, scene.emphasis))) {
          line.role = 'hero';
        }
      });
      if (!lines.some((line) => line.role === 'hero')) {
        lines[lines.length - 1].role = 'hero';
      }
    } else {
      lines[lines.length - 1].role = 'hero';
    }
    return lines;
  }

  const words = splitWords(sourceLines[0]);
  if (words.length === 0) return [];

  const heroFlags = hasEmphasis
    ? words.map((word) => isEmphasised(word, scene.emphasis))
    : words.map((_, index) => index === words.length - 1);

  if (!heroFlags.some(Boolean)) heroFlags[heroFlags.length - 1] = true;

  // SLIDE and MASSIVE read best as one continuous statement when nothing is
  // singled out; the other styles always separate support from hero.
  const singleLineStyles: AnimationStyle[] = ['slide', 'massive'];
  if (!hasEmphasis && singleLineStyles.includes(scene.style) && words.length <= 3) {
    return [{ role: 'hero', words }];
  }

  // Walk the words once and start a new line whenever the role changes. This
  // keeps every word in its typed position, and collapses to the usual two
  // lines for the common case of one contiguous emphasis.
  const lines: DraftLine[] = [];
  words.forEach((word, index) => {
    const role: WordRole = heroFlags[index] ? 'hero' : 'kicker';
    const current = lines[lines.length - 1];
    if (current && current.role === role) current.words.push(word);
    else lines.push({ role, words: [word] });
  });

  return lines;
};

/* ------------------------------------------------------------------ layout */

/**
 * Where a block sits horizontally under the V2 three-way alignment. Still the
 * placement rule for single-block scenes; V3 elements resolve their own `left`
 * from a position preset instead.
 */
export const blockLeft = (
  block: BlockLayout,
  alignment: Alignment,
  canvas: VideoConfig = CANVAS,
): number => {
  const margin = sideMargin(canvas);
  if (alignment === 'left') return margin;
  if (alignment === 'right') return canvas.width - margin - block.width;
  // Centre on the frame, not on the safe area — oversized type is meant to
  // bleed symmetrically off both edges.
  return (canvas.width - block.width) / 2;
};

/** Resolve every word's absolute ink centre once the block geometry is known. */
const resolveAbsolutePositions = (block: BlockLayout): void => {
  for (const line of block.lines) {
    const offset =
      line.align === 'left'
        ? 0
        : line.align === 'right'
          ? block.width - line.width
          : (block.width - line.width) / 2;
    for (const word of line.words) {
      word.cx = block.left + offset + word.x + word.width / 2;
      word.cy =
        block.top +
        line.top +
        (inkTop(word.text, word.fontSize) + inkBottom(word.text, word.fontSize)) / 2;
    }
  }
};

/** Move a laid-out block so its ink centre lands on (cx, cy). */
const placeBlock = (block: BlockLayout, cx: number, cy: number): void => {
  block.left = cx - block.width / 2;
  block.top = cy - block.inkCentre;
  resolveAbsolutePositions(block);
};

type LineSpec = { text: string; fontSize: number; weight: number };

/**
 * The shared layout kernel: stack lines on their ink, position words inside
 * each line, and report where the ink centre ended up.
 *
 * Both planners funnel through here. They differ only in how a line is sized
 * and aligned, which is what the two callbacks decide.
 */
const layoutLines = (
  idPrefix: string,
  drafts: DraftLine[],
  textCase: TextCase,
  style: AnimationStyle,
  heroSize: number,
  sizeOf: (draft: DraftLine, index: number, text: string) => LineSpec,
  alignOf: (draft: DraftLine, index: number, heroLineIndex: number) => Alignment,
  canvas: VideoConfig = CANVAS,
): BlockLayout => {
  const heroLineIndex = Math.max(
    0,
    drafts.findIndex((line) => line.role === 'hero'),
  );

  const sized = drafts.map((draft, index) =>
    sizeOf(draft, index, applyCase(draft.words.join(' '), textCase)),
  );

  const gap = LINE_GAP_EM * heroSize;

  // Lines are stacked on their *ink*, not on their line boxes: the gap between
  // one line's lowest ink and the next line's highest ink is held constant.
  // Stacking on boxes would leave the ascender/descender slack visible, which
  // is exactly what makes template kinetic type look loose.
  let lineTop = 0;
  const lines: PlannedLine[] = sized.map((entry, lineIndex) => {
    if (lineIndex > 0) {
      const previous = sized[lineIndex - 1];
      lineTop =
        lineTop +
        inkBottom(previous.text, previous.fontSize) +
        gap -
        inkTop(entry.text, entry.fontSize);
    }

    const draft = drafts[lineIndex];
    const width = widthOf(entry.text, entry.fontSize, entry.weight, canvas);
    const align = alignOf(draft, lineIndex, heroLineIndex);

    // Word-level x positions inside the line, so styles can animate words
    // independently without re-measuring.
    let cursor = 0;
    const words: PlannedWord[] = draft.words.map((raw, indexInLine) => {
      const text = applyCase(raw, textCase);
      const wordWidth = widthOf(text, entry.fontSize, entry.weight, canvas);
      const spaceWidth =
        indexInLine === draft.words.length - 1
          ? 0
          : widthOf(`${text} x`, entry.fontSize, entry.weight, canvas) -
            wordWidth -
            widthOf('x', entry.fontSize, entry.weight, canvas);
      const word: PlannedWord = {
        id: `${idPrefix}-l${lineIndex}-w${indexInLine}`,
        text,
        role: draft.role,
        lineIndex,
        order: 0,
        start: 0,
        duration: 0,
        style,
        fontSize: entry.fontSize,
        x: cursor,
        y: lineTop,
        width: wordWidth,
        cx: 0,
        cy: 0,
      };
      cursor += wordWidth + spaceWidth;
      return word;
    });

    return {
      id: `${idPrefix}-l${lineIndex}`,
      role: draft.role,
      text: entry.text,
      fontSize: entry.fontSize,
      weight: entry.weight,
      align,
      top: lineTop,
      width,
      words,
    };
  });

  if (lines.length === 0) return emptyBlock(0);

  const first = lines[0];
  const last = lines[lines.length - 1];
  const inkStart = first.top + inkTop(first.text, first.fontSize);
  const inkEnd = last.top + inkBottom(last.text, last.fontSize);
  const inkCentre = (inkStart + inkEnd) / 2;

  return {
    lines,
    top: -inkCentre,
    left: 0,
    height: last.top + last.fontSize,
    inkHeight: inkEnd - inkStart,
    inkCentre,
    width: Math.max(...lines.map((line) => line.width)),
    heroSize,
    heroLineIndex,
  };
};

/* --------------------------------------------------------- V2 single block */

const layoutBlock = (
  idPrefix: string,
  drafts: DraftLine[],
  heroSize: number,
  scene: Scene,
  textCase: TextCase,
  centreY: number,
  /**
   * Extra shrink applied when a picture leaves too little room. It has to move
   * the support-line clamp too, otherwise a multi-line block never converges:
   * the clamp holds the caption at a fixed size while only the hero gives way.
   */
  fit = 1,
  canvas: VideoConfig = CANVAS,
): BlockLayout => {
  const maxLineWidth = canvas.width * (SIZING[scene.style]?.target ?? 0.84);

  const block = layoutLines(
    idPrefix,
    drafts,
    textCase,
    scene.style,
    heroSize,
    (draft, _index, text) => {
      if (draft.role === 'hero') {
        return { text, fontSize: heroSize, weight: HERO_WEIGHT };
      }
      // Support words track the hero inside a fixed band, then are capped so a
      // long caption can never overflow the frame.
      const scale = (scene.fontSize ?? 1) * fit;
      const wanted = Math.min(
        kickerMax(canvas) * scale,
        Math.max(kickerMin(canvas) * scale, heroSize * KICKER_RATIO),
      );
      const ceiling = fitToWidth(text, maxLineWidth, KICKER_WEIGHT, canvas);
      return { text, fontSize: Math.min(wanted, ceiling), weight: KICKER_WEIGHT };
    },
    (draft, lineIndex, heroLineIndex) => {
      if (scene.alignment !== 'center') return scene.alignment;
      if (draft.role === 'hero') return 'center';
      // The reference grammar: support above the hero hangs left, support below
      // hangs right.
      return lineIndex < heroLineIndex ? 'left' : 'right';
    },
    canvas,
  );

  block.top = centreY - block.inkCentre;
  block.left = blockLeft(block, scene.alignment, canvas);
  return block;
};

/**
 * Lay the block out, then shrink it if it does not fit the band the picture
 * left behind. Width-driven sizing alone can produce a hero taller than the
 * space available once an image takes half the frame.
 */
const layoutBlockInBand = (
  idPrefix: string,
  drafts: DraftLine[],
  heroSize: number,
  scene: Scene,
  textCase: TextCase,
  centreY: number,
  bandHeight: number,
  canvas: VideoConfig = CANVAS,
): BlockLayout => {
  const limit = bandHeight * 0.94;
  let fit = 1;
  let block = layoutBlock(idPrefix, drafts, heroSize, scene, textCase, centreY, fit, canvas);

  // Two or three passes is plenty — every term scales linearly with `fit`, so
  // the ratio converges immediately. The loop exists for the multi-line case
  // where the support clamp makes the first estimate slightly optimistic.
  for (let pass = 0; pass < 4 && block.inkHeight > limit && block.inkHeight > 0; pass++) {
    fit *= limit / block.inkHeight;
    block = layoutBlock(idPrefix, drafts, heroSize * fit, scene, textCase, centreY, fit, canvas);
  }

  resolveAbsolutePositions(block);
  return block;
};

/* ------------------------------------------------------------------ timing */

/** Length of one STACK build step, in seconds. Measured in the reference. */
const STACK_BEAT_SECONDS = 0.3;

/**
 * Reveal timing per style.
 *
 * STACK divides the scene across its words — the reference builds
 * "meant" / "meant to" / "meant to run" on even beats. Everything else arrives
 * together, with support words trailing the hero by a beat or two (measured in
 * the reference: "worth making" lags "comparison").
 */
const assignTiming = (
  block: BlockLayout,
  style: AnimationStyle,
  durationInFrames: number,
  fps: number,
  /** Frames the whole element waits before any of it enters. */
  delay = 0,
): void => {
  const words = block.lines.flatMap((line) => line.words);
  if (words.length === 0) return;

  const hold = Math.max(0, Math.min(delay, Math.max(0, durationInFrames - 1)));
  const span = Math.max(1, durationInFrames - hold);

  if (style === 'stack') {
    // Each build step gets a fixed short beat (~0.3s in the reference) and the
    // payoff word holds everything left over. Splitting the scene evenly would
    // mean a longer scene just lingers on the setup — the opposite of what a
    // longer scene is for.
    const lead = words.length - 1;
    if (lead <= 0) {
      words[0].order = 0;
      words[0].start = hold;
      words[0].duration = durationInFrames - hold;
      return;
    }

    const beat = Math.max(2, Math.round(fps * STACK_BEAT_SECONDS));
    // Always leave the payoff at least a third of the scene, and never let the
    // build run past the end even when there are more words than frames — in
    // that case words simply land together rather than off the end.
    const payoffHold = Math.max(1, Math.round(span * 0.34));
    const budget = Math.min(lead * beat, Math.max(0, span - payoffHold));

    words.forEach((word, index) => {
      word.order = index;
      const raw = index < lead ? Math.round((index * budget) / lead) : budget;
      word.start = Math.max(0, Math.min(hold + raw, durationInFrames - 1));
      word.duration = durationInFrames - word.start;
    });
    return;
  }

  // Support that reads *before* the hero is a lead-in and belongs on screen
  // from the first frame; support that reads *after* is a qualifier and lands
  // better a beat late. The reference does exactly this — "is who" arrives with
  // "you", while "worth making" trails "comparison". Which one a line is comes
  // from its position in the sentence, not from a setting.
  const lag = style === 'rapid' ? 0 : 2;

  words.forEach((word, index) => {
    word.order = index;
    const trails = word.role === 'kicker' && word.lineIndex > block.heroLineIndex;
    word.start = Math.min(
      hold + (trails ? lag : 0),
      Math.max(0, durationInFrames - 1),
    );
    word.duration = durationInFrames - word.start;
  });
};

/* -------------------------------------------------------------------- rapid */

const rapidItems = (text: string): string[] => {
  const byLine = splitLines(text);
  if (byLine.length > 1) return byLine;
  const single = byLine[0] ?? '';
  // A comma- or period-separated list is the natural way to type a rapid
  // sequence ("AI. DESIGN. WEBSITES."), otherwise fall back to words.
  const punctuated = single
    .split(/(?<=[.,;!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (punctuated.length > 1) return punctuated;
  return splitWords(single);
};

const planRapid = (
  scene: Scene,
  durationInFrames: number,
  fps: number,
  palette: PaletteName,
  picture: ImageComposition,
  canvas: VideoConfig = CANVAS,
): RapidBeat[] => {
  const items = rapidItems(scene.text);
  if (items.length === 0) return [];

  const lengths = distributeFrames(durationInFrames, items.length);
  const offsets = cumulative(lengths);
  const flip = scene.flipBackground ?? true;
  const rule = SIZING.rapid;
  const scale = scene.fontSize ?? 1;

  return items.flatMap((item, index) => {
    // A beat that got no frames (more items than the scene can hold) is dropped
    // rather than forced to one frame, which would push every later beat past
    // the end of the scene.
    if (lengths[index] <= 0) return [];

    const emphasised = splitWords(item).some((word) =>
      isEmphasised(word, scene.emphasis),
    );
    const text = applyCase(item, scene.case ?? 'lower');
    const size = emphasised
      ? resolveHeroSize(text, rule, scale, HERO_WEIGHT, canvas)
      : Math.min(
          rapidBaseSize(canvas) * scale,
          fitToWidth(text, rule.target * canvas.width, HERO_WEIGHT, canvas),
        );

    const block = layoutBlockInBand(
      `${scene.id}-b${index}`,
      [{ role: 'hero', words: splitWords(item) }],
      size,
      scene,
      scene.case ?? 'lower',
      typeCentreY(picture),
      typeBandHeight(picture),
      canvas,
    );
    assignTiming(block, 'rapid', lengths[index], fps);

    return [
      {
        id: `${scene.id}-beat-${index}`,
        text,
        from: offsets[index],
        durationInFrames: lengths[index],
        background:
          flip && index % 2 === 1
            ? flipBackground(scene.background, palette)
            : scene.background,
        emphasised,
        block,
      },
    ];
  });
};

function emptyBlock(centreY: number): BlockLayout {
  return {
    lines: [],
    top: centreY,
    left: 0,
    height: 0,
    inkHeight: 0,
    inkCentre: 0,
    width: 0,
    heroSize: 0,
    heroLineIndex: 0,
  };
}

/* ------------------------------------------------------------ V3 elements */

/**
 * Merge an element's visual style over the scene's.
 *
 * Inheritance is the whole point: a scene says GRADIENT once and every element
 * in it is a gradient, and the one element that should not be says SOLID. The
 * only subtlety is that a config belongs to a *type* — inheriting a scene's
 * gradient stops into an element that asked for OUTLINE would apply settings
 * that style has no use for, so configs merge only when the types agree.
 */
export const mergeVisual = (
  scene: Scene,
  element?: Pick<SceneElement, 'visualStyle' | 'styleConfig'>,
): VisualStyleConfig => {
  const sceneType = scene.visualStyle ?? scene.styleConfig?.type ?? DEFAULT_VISUAL_STYLE;
  const type = element?.visualStyle ?? element?.styleConfig?.type ?? sceneType;
  const fromScene =
    scene.styleConfig && (scene.styleConfig.type ?? sceneType) === type
      ? scene.styleConfig
      : undefined;
  const fromElement =
    element?.styleConfig && (element.styleConfig.type ?? type) === type
      ? element.styleConfig
      : undefined;
  return { ...fromScene, ...fromElement, type };
};

/**
 * Per-word colours, element over scene.
 *
 * Keys are lower-cased on the way in so lookup is a plain map read at render
 * time — matching is case-insensitive for the same reason `emphasis` matching
 * is: the author typed "CUSTOMERS" and meant the word, not the casing.
 *
 * Returns undefined rather than an empty object when nothing is set, so the
 * common case costs no allocation and the renderer can skip the lookup
 * entirely.
 */
export const mergeWordColors = (
  scene: Scene,
  element?: Pick<SceneElement, 'wordColors'>,
): Record<string, string> | undefined => {
  const merged: Record<string, string> = {};
  for (const [word, colour] of Object.entries(scene.wordColors ?? {})) {
    merged[word.toLowerCase()] = colour;
  }
  for (const [word, colour] of Object.entries(element?.wordColors ?? {})) {
    merged[word.toLowerCase()] = colour;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

/** Everything an element needs before it can be measured. */
type ResolvedElement = {
  source: SceneElement;
  index: number;
  id: string;
  role: TextRole;
  size: SizePreset;
  /** True when `size` came from the role rather than from the author. */
  inheritedSize: boolean;
  position: PositionPreset | null;
  anchors: Anchors | null;
  style: AnimationStyle;
  align: Alignment | null;
  textCase: TextCase;
  scale: number;
  fontSize: number;
  weight: number;
  delay: number;
  drafts: DraftLine[];
  visual: VisualStyleConfig;
  wordColors?: Record<string, string>;
};

/**
 * The longest line decides the size for the whole element.
 *
 * Fitting each line on its own would give a two-line element two different
 * sizes for no reason the reader can see — a size is a property of the element,
 * not of a line.
 */
const longestLine = (drafts: DraftLine[], textCase: TextCase): string => {
  let longest = '';
  for (const draft of drafts) {
    const text = applyCase(draft.words.join(' '), textCase);
    if (text.length > longest.length) longest = text;
  }
  return longest;
};

const elementDrafts = (element: SceneElement): DraftLine[] => {
  const lines = splitLines(element.text);
  if (lines.length === 0) return [];
  // Every line of an element carries the element's role, so there is no hero /
  // kicker split inside it. Hierarchy between pieces of type is what the role
  // system is for; re-deriving a second hierarchy inside an element would put
  // two competing scales in one place.
  return lines.map((line) => ({ role: 'hero' as WordRole, words: splitWords(line) }));
};

const resolveElement = (
  element: SceneElement,
  index: number,
  scene: Scene,
  canvas: VideoConfig = CANVAS,
): ResolvedElement => {
  const role: TextRole = element.role ?? 'primary';
  const inheritedSize = element.size === undefined;
  const size: SizePreset = element.size ?? ROLE_SIZE[role];
  const textCase: TextCase = element.case ?? scene.case ?? 'as-typed';
  const drafts = elementDrafts(element);
  const weight = ROLE_WEIGHT_FACE[role];
  const scale = (element.scale ?? 1) * (scene.fontSize ?? 1);
  const fontSize = resolveSize(longestLine(drafts, textCase), size, scale, weight, canvas);

  return {
    source: element,
    index,
    id: element.id || `${scene.id}-e${index}`,
    role,
    size,
    inheritedSize,
    position: element.position ?? null,
    anchors: element.position ? anchorsFor(element.position) : null,
    style: element.animation ?? scene.style,
    align: element.align ?? null,
    textCase,
    scale,
    fontSize,
    weight,
    delay: element.delay ?? 0,
    drafts,
    visual: mergeVisual(scene, element),
    wordColors: mergeWordColors(scene, element),
  };
};

/**
 * Enforce hierarchy.
 *
 * Sizing every element from its own preset is not enough: a three-letter
 * SUPPORT word hits its ceiling while a long PRIMARY line shrinks to fit, and
 * the frame ends up saying the wrong thing loudest. Lower roles are capped
 * against whatever dominates — the same relationship the reference holds
 * between its hero and its support line, generalised to four steps.
 *
 * Only sizes inherited from the role are capped. An explicit `size` is the
 * author overruling the default on purpose, and V3 lets them.
 */
const enforceHierarchy = (
  elements: ResolvedElement[],
  dominant: ResolvedElement,
  canvas: VideoConfig = CANVAS,
): void => {
  const W = canvas.width;
  for (const element of elements) {
    if (element === dominant || !element.inheritedSize) continue;
    const ceiling = ROLE_CEILING[element.role] * dominant.fontSize;
    const floor = ROLE_FLOOR[element.role] * W;
    const capped = Math.min(element.fontSize, Math.max(floor, ceiling));
    element.fontSize = Math.max(Math.min(capped, element.fontSize), floor);
  }
};

/**
 * How much of an element's ink is inside the frame.
 *
 * The auto-fit policy is built on this rather than on "does it fit", because
 * for HUGE and OVERSIZED the answer to "does it fit" is *supposed* to be no.
 */
const visibleFraction = (
  cx: number,
  cy: number,
  width: number,
  height: number,
  canvas: VideoConfig = CANVAS,
): number => {
  if (width <= 0 || height <= 0) return 1;
  const w =
    Math.max(0, Math.min(cx + width / 2, canvas.width) - Math.max(cx - width / 2, 0)) /
    width;
  const h =
    Math.max(0, Math.min(cy + height / 2, canvas.height) - Math.max(cy - height / 2, 0)) /
    height;
  return Math.min(w, h);
};

const layoutElementBlock = (
  element: ResolvedElement,
  fontSize: number,
  align: Alignment,
  canvas: VideoConfig = CANVAS,
): BlockLayout =>
  layoutLines(
    element.id,
    element.drafts,
    element.textCase,
    element.style,
    fontSize,
    (_draft, _index, text) => ({ text, fontSize, weight: element.weight }),
    () => align,
    canvas,
  );

/**
 * Measure an element, shrinking it **only** when it has stopped being usable.
 *
 * Three steps, in the order the brief states them: take the size that was
 * asked for, allow the clipping that implies, and intervene only when so
 * little of the word is left on screen that it is no longer a word. A layout
 * engine's instinct here is to shrink until everything fits, and that instinct
 * is exactly what makes display typography look timid.
 */
const measureElement = (
  element: ResolvedElement,
  align: Alignment,
  anchors: Anchors,
  band: Band,
  hasFixedPlacement: boolean,
  canvas: VideoConfig = CANVAS,
): BlockLayout => {
  const rule = sizeRule(element.size);
  const bandLimit = (band.bottom - band.top) * rule.bandRoom;
  const offscreen = anchors.h.startsWith('off') || anchors.v.startsWith('off');

  let fontSize = element.fontSize;
  let block = layoutElementBlock(element, fontSize, align, canvas);

  for (let pass = 0; pass < 4; pass++) {
    const tall = block.inkHeight > bandLimit && block.inkHeight > 0;
    // An element parked offscreen, or pinned to explicit coordinates, has opted
    // out of the visibility rule — being off the frame is the instruction.
    const visible =
      offscreen || hasFixedPlacement
        ? 1
        : visibleFraction(
            anchorX(anchors.h, block.width, canvas),
            anchorY(anchors.v, block.inkHeight, band, canvas),
            block.width,
            block.inkHeight,
            canvas,
          );

    if (!tall && visible >= rule.minVisible) break;

    const byHeight = tall ? bandLimit / block.inkHeight : 1;
    const byVisible = visible > 0 ? Math.min(1, visible / rule.minVisible) : 0.5;
    fontSize *= Math.min(byHeight, byVisible) * 0.995;
    if (!(fontSize > 0)) break;
    block = layoutElementBlock(element, fontSize, align, canvas);
  }

  element.fontSize = fontSize;
  return block;
};

const planRapidElement = (
  element: ResolvedElement,
  scene: Scene,
  durationInFrames: number,
  fps: number,
  palette: PaletteName,
  align: Alignment,
  canvas: VideoConfig = CANVAS,
): RapidBeat[] => {
  const items = rapidItems(element.source.text);
  if (items.length === 0) return [];

  const lengths = distributeFrames(durationInFrames, items.length);
  const offsets = cumulative(lengths);
  const flip = scene.flipBackground ?? true;

  return items.flatMap((item, index) => {
    if (lengths[index] <= 0) return [];
    const words = splitWords(item);
    const emphasised = words.some((word) =>
      isEmphasised(word, element.source.emphasis ?? scene.emphasis),
    );
    const text = applyCase(item, element.textCase);
    const beatElement: ResolvedElement = {
      ...element,
      id: `${element.id}-b${index}`,
      drafts: [{ role: 'hero', words }],
    };
    const block = layoutElementBlock(beatElement, element.fontSize, align, canvas);
    assignTiming(block, 'rapid', lengths[index], fps);

    return [
      {
        id: `${element.id}-beat-${index}`,
        text,
        from: offsets[index],
        durationInFrames: lengths[index],
        background:
          flip && index % 2 === 1
            ? flipBackground(scene.background, palette)
            : scene.background,
        emphasised,
        block,
      },
    ];
  });
};

const planComposed = (
  scene: Scene,
  durationInFrames: number,
  fps: number,
  palette: PaletteName,
  picture: ImageComposition,
  canvas: VideoConfig = CANVAS,
): ScenePlan => {
  const band: Band = { top: picture.typeTop, bottom: picture.typeBottom };

  const resolved = (scene.elements ?? [])
    .map((element, index) => resolveElement(element, index, scene, canvas))
    .filter((element) => element.drafts.length > 0);

  if (resolved.length === 0) {
    return {
      scene,
      style: scene.style,
      durationInFrames,
      background: scene.background,
      picture,
      layout: scene.composition ?? 'center',
      elements: [],
      block: emptyBlock(bandCentre(band)),
      beats: [],
      words: [],
    };
  }

  /* which element owns the frame ------------------------------------------ */
  let dominant = resolved[0];
  for (const element of resolved) {
    const better =
      ROLE_WEIGHT[element.role] > ROLE_WEIGHT[dominant.role] ||
      (ROLE_WEIGHT[element.role] === ROLE_WEIGHT[dominant.role] &&
        element.fontSize > dominant.fontSize);
    if (better) dominant = element;
  }
  enforceHierarchy(resolved, dominant, canvas);

  const layout = scene.composition ?? suggestComposition(resolved.length, dominant.size);
  const definition = compositionDefinition(layout);
  const dominantIndex = resolved.indexOf(dominant);

  /* anchors ---------------------------------------------------------------- */
  const anchorsOf = (element: ResolvedElement, index: number): Anchors => {
    if (element.anchors) return element.anchors;
    if (definition.absolute) {
      return definition.absolute[index % definition.absolute.length];
    }
    return {
      h: definition.column(index - dominantIndex, index),
      v: definition.vertical,
    };
  };

  /* measure ---------------------------------------------------------------- */
  const anchors = resolved.map(anchorsOf);
  const aligns = resolved.map(
    (element, index) => element.align ?? alignForAnchor(anchors[index].h),
  );
  const fixed = resolved.map((element) =>
    typeof element.source.x === 'number' && typeof element.source.y === 'number'
      ? {
          cx: element.source.x * canvas.width,
          cy: element.source.y * canvas.height,
        }
      : undefined,
  );

  const blocks = resolved.map((element, index) =>
    element.style === 'rapid'
      ? layoutElementBlock(element, element.fontSize, aligns[index], canvas)
      : measureElement(
          element,
          aligns[index],
          anchors[index],
          band,
          fixed[index] !== undefined,
          canvas,
        ),
  );

  /* place ------------------------------------------------------------------ */
  const items: FlowItem[] = resolved.map((element, index) => ({
    width: blocks[index].width,
    height: blocks[index].inkHeight,
    anchors: anchors[index],
    fixed: fixed[index],
    // An element that named its own position is pinned there. Everything else
    // joins the flow, which is what keeps a composition from becoming a pile.
    flows:
      fixed[index] === undefined &&
      element.position === null &&
      definition.absolute === undefined,
  }));

  const placements = separate(items, layOut(items, definition, band, canvas), canvas);

  /* build ------------------------------------------------------------------ */
  const elements: PlannedElement[] = resolved.map((element, index) => {
    const block = blocks[index];
    const place = placements[index];
    placeBlock(block, place.cx, place.cy);

    const beats =
      element.style === 'rapid'
        ? planRapidElement(
            element,
            scene,
            durationInFrames,
            fps,
            palette,
            aligns[index],
            canvas,
          )
        : [];
    for (const beat of beats) placeBlock(beat.block, place.cx, place.cy);

    const delayFrames = Math.max(0, Math.round(element.delay * fps));
    if (element.style !== 'rapid') {
      assignTiming(block, element.style, durationInFrames, fps, delayFrames);
    }

    // An entrance origin, when the element asked to come in from offscreen.
    const from = element.source.from
      ? (() => {
          const origin = anchorsFor(element.source.from as PositionPreset);
          return {
            x: anchorX(origin.h, block.width, canvas) - place.cx,
            y: anchorY(origin.v, block.inkHeight, band, canvas) - place.cy,
          };
        })()
      : undefined;

    return {
      id: element.id,
      index,
      role: element.role,
      size: element.size,
      position: element.position ?? 'center',
      style: element.style,
      align: aligns[index],
      block,
      beats,
      from,
      delay: delayFrames,
      motion: ROLE_MOTION[element.role],
      visual: element.visual,
      wordColors: element.wordColors,
      dominant: index === dominantIndex,
    };
  });

  const anchor = elements[dominantIndex] ?? elements[0];

  return {
    scene,
    style: anchor.style,
    durationInFrames,
    background: scene.background,
    picture,
    layout,
    elements,
    block: anchor.block,
    beats: anchor.beats,
    words: elements.flatMap((element) =>
      (element.beats.length > 0
        ? element.beats.flatMap((beat) =>
            beat.block.lines.flatMap((line) =>
              line.words.map((word) => ({ word, offset: beat.from })),
            ),
          )
        : element.block.lines.flatMap((line) =>
            line.words.map((word) => ({ word, offset: 0 })),
          )
      ).map(({ word, offset }) => ({
        text: word.text,
        start: offset + word.start,
        duration: word.duration,
        style: element.style,
        fontSize: word.fontSize,
        x: word.x,
        y: word.y,
      })),
    ),
  };
};

/* --------------------------------------------------------- V2 single scene */

const planSingle = (
  scene: Scene,
  durationInFrames: number,
  fps: number,
  palette: PaletteName,
  picture: ImageComposition,
  canvas: VideoConfig = CANVAS,
): ScenePlan => {
  const textCase = scene.case ?? 'lower';
  const centreY = typeCentreY(picture);
  const bandHeight = typeBandHeight(picture);

  const single = (
    block: BlockLayout,
    beats: RapidBeat[],
    words: WordAnimation[],
  ): ScenePlan => ({
    scene,
    style: scene.style,
    durationInFrames,
    background: scene.background,
    picture,
    layout: 'center',
    elements: [
      {
        id: `${scene.id}-e0`,
        index: 0,
        role: 'primary',
        size: 'large',
        position: 'center',
        style: scene.style,
        align: scene.alignment,
        block,
        beats,
        delay: 0,
        motion: 1,
        visual: mergeVisual(scene),
        // The V2 path has no elements, so scene-level colours are all there is.
        wordColors: mergeWordColors(scene),
        dominant: true,
      },
    ],
    block,
    beats,
    words,
  });

  if (scene.style === 'rapid') {
    const beats = planRapid(scene, durationInFrames, fps, palette, picture, canvas);
    return single(
      beats[0]?.block ?? emptyBlock(centreY),
      beats,
      beats.flatMap((beat) =>
        beat.block.lines.flatMap((line) =>
          line.words.map((word) => ({
            text: word.text,
            start: beat.from + word.start,
            duration: word.duration,
            style: scene.style,
            fontSize: word.fontSize,
            x: word.x,
            y: word.y,
          })),
        ),
      ),
    );
  }

  const drafts = draftLines(scene);
  if (drafts.length === 0) return single(emptyBlock(centreY), [], []);

  const heroDraft = drafts.find((line) => line.role === 'hero') ?? drafts[0];
  const heroText = applyCase(heroDraft.words.join(' '), textCase);
  const rule = SIZING[scene.style] ?? SIZING.punch;
  const heroSize = resolveHeroSize(heroText, rule, scene.fontSize ?? 1, HERO_WEIGHT, canvas);

  const block = layoutBlockInBand(
    scene.id,
    drafts,
    heroSize,
    scene,
    textCase,
    centreY,
    bandHeight,
    canvas,
  );
  assignTiming(block, scene.style, durationInFrames, fps);

  return single(
    block,
    [],
    block.lines.flatMap((line) =>
      line.words.map((word) => ({
        text: word.text,
        start: word.start,
        duration: word.duration,
        style: scene.style,
        fontSize: word.fontSize,
        x: word.x,
        y: word.y,
      })),
    ),
  );
};

/* -------------------------------------------------------------------- plan */

export const planScene = (
  scene: Scene,
  durationInFrames: number,
  fps: number = CANVAS.fps,
  palette: PaletteName = DEFAULT_PALETTE,
  /**
   * The project's frame. Defaults to portrait so every existing caller —
   * scripts, tests, anything not yet updated — keeps planning exactly the
   * scenes it always did. A landscape project threads its own canvas down
   * from `SceneRenderer`, which is the only place that knows the format.
   */
  canvas: VideoConfig = CANVAS,
): ScenePlan => {
  const picture = composeImage(scene.image, canvas);
  return scene.elements && scene.elements.length > 0
    ? planComposed(scene, durationInFrames, fps, palette, picture, canvas)
    : planSingle(scene, durationInFrames, fps, palette, picture, canvas);
};

/** Every word on screen in a scene, across all its elements. */
export const wordsOfPlan = (plan: ScenePlan): PlannedWord[] =>
  plan.elements.flatMap((element) => element.block.lines.flatMap((line) => line.words));
