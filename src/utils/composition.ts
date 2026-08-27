/**
 * The composition system — V3.
 *
 * V2 asked "how does the type move?". This file asks "where does the type
 * *live*?", which is the question a designer answers first and a kinetic-type
 * template never answers at all.
 *
 * Three vocabularies, all semantic:
 *
 *   ROLE      what a piece of type is for      PRIMARY / SECONDARY / EMPHASIS / SUPPORT
 *   SIZE      how big it wants to be           XS … OVERSIZED
 *   POSITION  where it sits in the frame       TOP_LEFT … EDGE_RIGHT … OFFSCREEN_TOP
 *
 * plus COMPOSITION, which fills in the positions an author did not give.
 *
 * Nothing here knows about pixels-per-word. Sizes resolve through the same
 * `resolveHeroSize` the V2 styles use, so a size preset is a `SizingRule` and
 * not a parallel type scale — the two systems cannot drift apart.
 */

import type {
  Alignment,
  CompositionPreset,
  PositionPreset,
  SizePreset,
  TextRole,
  VideoConfig,
} from '../types/scene';
import { CANVAS } from './timing';
import { fitToWidth, sideMargin } from './typography';

/* -------------------------------------------------------------------- roles */

export const TEXT_ROLES: TextRole[] = ['primary', 'secondary', 'emphasis', 'support'];

export const ROLE_LABEL: Record<TextRole, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  emphasis: 'EMPHASIS',
  support: 'SUPPORT',
};

/**
 * Which role dominates the frame. Used to pick the scene's anchor element — the
 * one the composition is built around and the one whose style drives the
 * scene-level behaviour (field cuts, transitions).
 */
export const ROLE_WEIGHT: Record<TextRole, number> = {
  emphasis: 4,
  primary: 3,
  secondary: 2,
  support: 1,
};

/** The size a role takes when the author does not name one. */
export const ROLE_SIZE: Record<TextRole, SizePreset> = {
  // Not OVERSIZED by default: bleeding off the frame is a decision, not a
  // default. HUGE already fills the frame edge to edge, and OVERSIZED is one
  // word away when the scene wants it.
  emphasis: 'huge',
  primary: 'large',
  secondary: 'medium',
  support: 'small',
};

/**
 * Hierarchy, expressed the way the reference expresses it: as a *ceiling*
 * relative to whatever dominates the frame, not as a fixed ratio.
 *
 * This is the four-role generalisation of the measured two-step scale — the
 * reference's support line never exceeds roughly a quarter of its hero however
 * large or small that hero is. Without this a short SUPPORT word ("no.") sized
 * by its own preset can out-measure a long PRIMARY line that had to shrink to
 * fit, and the frame reads with its hierarchy inverted.
 *
 * Applied only where the size was *inherited from the role*. An explicitly
 * chosen size is an art-direction decision and is left alone.
 */
export const ROLE_CEILING: Record<TextRole, number> = {
  emphasis: 1,
  primary: 1,
  secondary: 0.46,
  support: 0.3,
};

/**
 * ...and a floor, for the same reason the support line has one: a caption that
 * scales purely off a huge hero either vanishes or swamps the frame. Fractions
 * of frame width.
 */
export const ROLE_FLOOR: Record<TextRole, number> = {
  emphasis: 0.12,
  primary: 0.1,
  secondary: 0.07,
  support: 0.055,
};

/**
 * The face a role is set in.
 *
 * The reference sets everything at one weight, and for a two-step scale that is
 * right — size alone carries the hierarchy. Four steps is more than size can
 * separate cleanly, so the extremes take the extreme faces and the two middle
 * roles share one. Restraint matters here: a different weight per role is a
 * weight salad, not a hierarchy.
 */
export const ROLE_WEIGHT_FACE: Record<TextRole, number> = {
  emphasis: 900,
  primary: 800,
  secondary: 800,
  support: 700,
};

/**
 * Entrance amplitude per role — how far a piece of type travels on its way in,
 * as a multiple of its style's own throw.
 *
 * The brief asks EMPHASIS to receive stronger animation, and the inverse
 * matters just as much: a SUPPORT line that arrives as hard as the headline is
 * competing with it. Applied as a scale on the *deviation from rest*, so it
 * works for every style without any of them knowing about roles.
 */
export const ROLE_MOTION: Record<TextRole, number> = {
  emphasis: 1.25,
  primary: 1,
  secondary: 0.85,
  support: 0.68,
};

/* -------------------------------------------------------------------- sizes */

export const SIZE_PRESETS: SizePreset[] = [
  'xs',
  'small',
  'medium',
  'large',
  'huge',
  'oversized',
];

export const SIZE_LABEL: Record<SizePreset, string> = {
  xs: 'XS',
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE',
  huge: 'HUGE',
  oversized: 'OVERSIZED',
};

export type SizeDefinition = {
  /** Line width as a multiple of the frame width, before any overhang. */
  target: number;
  /**
   * The most this size may hang past the frame, added to `target`, for the
   * shortest possible word. Decays to zero over `bleedSpan` characters.
   */
  bleed: number;
  bleedSpan: number;
  /** Hard ceiling on the font size, as a multiple of frame width. */
  max: number;
  /** Floor, so pathological input never disappears. */
  min: number;
  /**
   * How far the ink may run past the type band before the planner treats it as
   * unusable and shrinks. 1 means "must fit"; 1.9 means "may be nearly twice
   * the band and that is fine".
   *
   * This is the whole of the auto-fit policy. Shrink-to-fit is the default
   * behaviour of every layout engine and it is exactly what flattens display
   * typography — CUSTOMERS at HUGE is *supposed* to touch both edges.
   */
  bandRoom: number;
  /**
   * The fraction of the ink that must still be inside the frame. Below this the
   * text has stopped being text, and only then does the planner intervene.
   */
  minVisible: number;
};

/**
 * The type scale.
 *
 * `target` is the line width as a multiple of the frame, so a long line lands on
 * it and a short one hits `max` — the two-step behaviour measured in the
 * reference, where "were", "never" and "run" all come out the same size.
 *
 * **Overhang shrinks as words get longer.** MASSIVE establishes the principle
 * (`shortTarget` 1.08 below five characters, contained above it) and V3 needs
 * the continuous version of it, because the brief asks for both MORE and
 * CUSTOMERS to bleed and those are four and nine characters. The rule that
 * covers both: the shorter the word, the more of it you can afford to lose. A
 * three-letter word survives a third of itself being cropped — the eye
 * reconstructs it from the silhouette — and a fourteen-letter one does not
 * survive any.
 */
export const SIZE_RULES: Record<SizePreset, SizeDefinition> = {
  xs: { target: 0.32, bleed: 0, bleedSpan: 1, max: 0.072, min: 0.038, bandRoom: 1, minVisible: 0.995 },
  // Lands inside the reference's measured support band (0.078–0.105 · W).
  small: { target: 0.46, bleed: 0, bleedSpan: 1, max: 0.105, min: 0.058, bandRoom: 1, minVisible: 0.995 },
  medium: { target: 0.64, bleed: 0, bleedSpan: 1, max: 0.2, min: 0.075, bandRoom: 1, minVisible: 0.99 },
  // The reference's hero band: 80–84% of the frame width, fully readable.
  large: { target: 0.84, bleed: 0, bleedSpan: 1, max: 0.345, min: 0.1, bandRoom: 1.04, minVisible: 0.97 },
  // Edge to edge, with just enough overhang on a short word that HUGE reads as
  // a crop rather than as a word that happens to be big.
  huge: {
    target: 0.965,
    bleed: 0.14,
    bleedSpan: 12,
    max: 0.66,
    min: 0.13,
    bandRoom: 1.35,
    minVisible: 0.74,
  },
  // Deliberately outside the frame. MORE (4) lands near 1.33 and loses about
  // half a character at each edge; CUSTOMERS (9) lands near 1.18; anything past
  // fourteen characters stops bleeding altogether and merely fills the frame.
  oversized: {
    target: 0.965,
    bleed: 0.42,
    bleedSpan: 14,
    // Height-derived, as MASSIVE's is: 0.40 · H of cap height ÷ 0.727 ≈ 0.98 · W.
    // Only one- and two-character words ever reach it.
    max: 0.98,
    min: 0.16,
    bandRoom: 1.9,
    minVisible: 0.5,
  },
};

export const sizeRule = (size: SizePreset): SizeDefinition =>
  SIZE_RULES[size] ?? SIZE_RULES.large;

/**
 * The width a piece of type aims for, as a multiple of the frame.
 *
 * Split out so the curve is inspectable on its own: `targetWidth('huge', 4)`
 * should read as a number a designer can argue with.
 */
export const targetWidth = (size: SizePreset, chars: number): number => {
  const rule = sizeRule(size);
  if (rule.bleed <= 0) return rule.target;
  const decay = Math.max(0, 1 - Math.max(0, chars - 1) / rule.bleedSpan);
  return rule.target + rule.bleed * decay;
};

/**
 * Resolve a semantic size to a font size in px.
 *
 * The same shape as `resolveHeroSize` — fill to a target, clamp to the rule's
 * ceiling and floor — with the length-aware target above in place of the
 * binary short/long tier.
 */
export const resolveSize = (
  text: string,
  size: SizePreset,
  scale = 1,
  weight = 800,
  canvas: VideoConfig = CANVAS,
): number => {
  const rule = sizeRule(size);
  const chars = text.replace(/\s+/g, '').length;
  if (chars === 0) return 0;
  const W = canvas.width;
  const fitted = fitToWidth(text, targetWidth(size, chars) * W, weight, canvas);

  /**
   * The floor exists so pathological input never disappears — it must never be
   * the reason type runs off the frame.
   *
   * Capping it at the frame-filling size matters most at the top of the scale,
   * where `min` is large: a thirteen-character line at OVERSIZED wants about
   * 130px and the raw 0.16·W floor inflated it to 173px, which pushed it to
   * 1.36 × frame width — *more* overhang than a four-letter word gets, exactly
   * inverting the rule the bleed curve exists to express. Bleeding is the
   * target's decision; the floor only stops text vanishing.
   */
  const fills = fitToWidth(text, W, weight, canvas);
  const floor = Math.min(rule.min * W, fills);

  return Math.max(floor, Math.min(rule.max * W, fitted)) * scale;
};

/** Whether a size is one that expects to run past the frame. */
export const bleeds = (size: SizePreset): boolean =>
  size === 'huge' || size === 'oversized';

/* ---------------------------------------------------------------- positions */

export const POSITION_PRESETS: PositionPreset[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'edge-left',
  'edge-right',
  'edge-top',
  'edge-bottom',
  'offscreen-left',
  'offscreen-right',
  'offscreen-top',
  'offscreen-bottom',
];

export const POSITION_LABEL = (position: PositionPreset): string =>
  position.replace(/-/g, '_').toUpperCase();

/** Horizontal anchors a composition can hand an element. */
export type HAnchor = 'left' | 'center' | 'right' | 'edge-left' | 'edge-right' | 'off-left' | 'off-right';
/** Vertical anchors. */
export type VAnchor = 'top' | 'center' | 'bottom' | 'edge-top' | 'edge-bottom' | 'off-top' | 'off-bottom';

export type Anchors = { h: HAnchor; v: VAnchor };

const POSITION_ANCHORS: Record<PositionPreset, Anchors> = {
  'top-left': { h: 'left', v: 'top' },
  'top-center': { h: 'center', v: 'top' },
  'top-right': { h: 'right', v: 'top' },
  'center-left': { h: 'left', v: 'center' },
  center: { h: 'center', v: 'center' },
  'center-right': { h: 'right', v: 'center' },
  'bottom-left': { h: 'left', v: 'bottom' },
  'bottom-center': { h: 'center', v: 'bottom' },
  'bottom-right': { h: 'right', v: 'bottom' },
  'edge-left': { h: 'edge-left', v: 'center' },
  'edge-right': { h: 'edge-right', v: 'center' },
  'edge-top': { h: 'center', v: 'edge-top' },
  'edge-bottom': { h: 'center', v: 'edge-bottom' },
  'offscreen-left': { h: 'off-left', v: 'center' },
  'offscreen-right': { h: 'off-right', v: 'center' },
  'offscreen-top': { h: 'center', v: 'off-top' },
  'offscreen-bottom': { h: 'center', v: 'off-bottom' },
};

export const anchorsFor = (position: PositionPreset): Anchors =>
  POSITION_ANCHORS[position] ?? POSITION_ANCHORS.center;

/**
 * How far an `edge-*` element hangs past the frame.
 *
 * Proportional to the ink so a big word bleeds decisively, capped against the
 * frame so a small word only pokes out. A flat pixel value does one of those
 * two jobs badly.
 */
const edgeBleed = (extent: number, frameExtent: number): number =>
  Math.min(extent * 0.16, frameExtent * 0.07);


/** The vertical band the type may use — narrowed when a picture takes room. */
export type Band = { top: number; bottom: number };

export const bandCentre = (band: Band): number => (band.top + band.bottom) / 2;

/**
 * Resolve a horizontal anchor to the ink centre, in canvas px.
 *
 * Centre is on the *frame*, not on the safe area: oversized type is meant to
 * bleed symmetrically off both edges, and centring it inside the margins would
 * quietly bias every big word to the right.
 */
export const anchorX = (h: HAnchor, inkWidth: number, canvas: VideoConfig = CANVAS): number => {
  const W = canvas.width;
  const margin = sideMargin(canvas);
  const half = inkWidth / 2;
  switch (h) {
    case 'left':
      return margin + half;
    case 'right':
      return W - margin - half;
    case 'edge-left':
      return half - edgeBleed(inkWidth, W);
    case 'edge-right':
      return W - half + edgeBleed(inkWidth, W);
    case 'off-left':
      return -half - margin;
    case 'off-right':
      return W + half + margin;
    case 'center':
    default:
      return W / 2;
  }
};

export const anchorY = (
  v: VAnchor,
  inkHeight: number,
  band: Band,
  canvas: VideoConfig = CANVAS,
): number => {
  const H = canvas.height;
  const margin = sideMargin(canvas);
  const half = inkHeight / 2;
  switch (v) {
    case 'top':
      return band.top + margin + half;
    case 'bottom':
      return band.bottom - margin - half;
    case 'edge-top':
      return half - edgeBleed(inkHeight, H);
    case 'edge-bottom':
      return H - half + edgeBleed(inkHeight, H);
    case 'off-top':
      return -half - margin;
    case 'off-bottom':
      return H + half + margin;
    case 'center':
    default:
      return bandCentre(band);
  }
};

/** Text alignment implied by where an element sits, unless it names its own. */
export const alignForAnchor = (h: HAnchor): Alignment => {
  if (h === 'left' || h === 'edge-left' || h === 'off-left') return 'left';
  if (h === 'right' || h === 'edge-right' || h === 'off-right') return 'right';
  return 'center';
};

/* ------------------------------------------------------------- compositions */

export const COMPOSITION_PRESETS: CompositionPreset[] = [
  'center',
  'left-stack',
  'right-stack',
  'top-statement',
  'bottom-statement',
  'split',
  'oversized-center',
  'corner',
];

export type CompositionDefinition = {
  id: CompositionPreset;
  label: string;
  /** One line, shown in the editor. */
  description: string;
  /**
   * Where the flowed stack sits inside the type band.
   */
  vertical: 'top' | 'center' | 'bottom';
  /** Air between flowed elements, as a fraction of frame height. */
  gap: number;
  /**
   * The column an element hangs from.
   *
   * `offset` is the element's position relative to the dominant one: negative
   * before it, 0 for the dominant itself, positive after. Several presets use
   * the reference's own grammar here — support that reads *before* the hero
   * hangs left, support that reads *after* hangs right — which is the same rule
   * `alignmentForLine` applies within a single block.
   */
  column: (offset: number, index: number) => HAnchor;
  /**
   * Fixed placements by index instead of a flow. CORNER is the only preset that
   * works this way: corners are positions, not a stack.
   */
  absolute?: Anchors[];
};

const HOUSE_GRAMMAR = (offset: number): HAnchor =>
  offset === 0 ? 'left' : offset < 0 ? 'left' : 'right';

export const COMPOSITIONS: Record<CompositionPreset, CompositionDefinition> = {
  center: {
    id: 'center',
    label: 'CENTER',
    description: 'Centred type. Statements, hooks, punchlines.',
    vertical: 'center',
    gap: 0.02,
    column: () => 'center',
  },
  'left-stack': {
    id: 'left-stack',
    label: 'LEFT_STACK',
    description: 'Everything hangs off the left margin. Editorial, asymmetric.',
    vertical: 'center',
    gap: 0.02,
    column: () => 'left',
  },
  'right-stack': {
    id: 'right-stack',
    label: 'RIGHT_STACK',
    description: 'Everything hangs off the right margin.',
    vertical: 'center',
    gap: 0.02,
    column: () => 'right',
  },
  'top-statement': {
    id: 'top-statement',
    label: 'TOP_STATEMENT',
    description: 'Statement in the upper region, support below it.',
    vertical: 'top',
    gap: 0.026,
    column: HOUSE_GRAMMAR,
  },
  'bottom-statement': {
    id: 'bottom-statement',
    label: 'BOTTOM_STATEMENT',
    description: 'Statement anchored low, with air above it.',
    vertical: 'bottom',
    gap: 0.026,
    column: HOUSE_GRAMMAR,
  },
  split: {
    id: 'split',
    label: 'SPLIT',
    description: 'Elements thrown to opposite margins with real air between them.',
    vertical: 'center',
    // Wide on purpose. A split with a tight gap is just a ragged stack; the
    // separation *is* the composition.
    gap: 0.055,
    column: (_offset, index) => (index % 2 === 0 ? 'left' : 'right'),
  },
  'oversized-center': {
    id: 'oversized-center',
    label: 'OVERSIZED_CENTER',
    description: 'One word owns the frame. Everything else gets out of its way.',
    vertical: 'center',
    gap: 0.03,
    column: (offset) => (offset === 0 ? 'center' : offset < 0 ? 'left' : 'right'),
  },
  corner: {
    id: 'corner',
    label: 'CORNER',
    description: 'Type pushed into opposite corners. Maximum negative space.',
    vertical: 'center',
    gap: 0.03,
    column: () => 'left',
    // Diagonal first: two elements should sit across the frame from each other,
    // which is the whole reason to reach for CORNER.
    absolute: [
      { h: 'left', v: 'top' },
      { h: 'right', v: 'bottom' },
      { h: 'right', v: 'top' },
      { h: 'left', v: 'bottom' },
    ],
  },
};

export const compositionDefinition = (
  preset: CompositionPreset | undefined,
): CompositionDefinition => COMPOSITIONS[preset ?? 'center'] ?? COMPOSITIONS.center;

/**
 * A composition that suits an element list when the author has not chosen one.
 *
 * Deliberately not "centre everything": a single dominant word wants the frame,
 * but the moment there is a second element the scene is a composition and
 * centring both is the flattest thing it could do.
 */
export const suggestComposition = (
  count: number,
  dominantSize: SizePreset,
): CompositionPreset => {
  if (count <= 1) return bleeds(dominantSize) ? 'oversized-center' : 'center';
  if (count === 2) return 'left-stack';
  return 'split';
};

/* ----------------------------------------------------------------- the flow */

export type FlowItem = {
  /** Ink extents, already measured. */
  width: number;
  height: number;
  /** Resolved anchors, or null when the element carries explicit coordinates. */
  anchors: Anchors | null;
  /** Explicit ink centre, in canvas px. Wins over everything. */
  fixed?: { cx: number; cy: number };
  /** True when this element flows with the stack rather than being pinned. */
  flows: boolean;
};

export type Placement = { cx: number; cy: number };

/**
 * Place the elements.
 *
 * Elements that flow are stacked in **reading order** inside the band — the same
 * rule the single-block planner follows, and for the same reason: the order
 * words appear in is a property of the sentence, never of the layout. Elements
 * with a position of their own are pinned where they ask to be.
 */
export const layOut = (
  items: FlowItem[],
  definition: CompositionDefinition,
  band: Band,
  canvas: VideoConfig = CANVAS,
): Placement[] => {
  const placements: Placement[] = items.map(() => ({ cx: 0, cy: 0 }));
  const margin = sideMargin(canvas);

  const flowing = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.flows);

  /* pinned ---------------------------------------------------------------- */
  items.forEach((item, index) => {
    if (item.flows) return;
    if (item.fixed) {
      placements[index] = item.fixed;
      return;
    }
    const anchors = item.anchors ?? { h: 'center', v: 'center' };
    placements[index] = {
      cx: anchorX(anchors.h, item.width, canvas),
      cy: anchorY(anchors.v, item.height, band, canvas),
    };
  });

  if (flowing.length === 0) return placements;

  /* flowed ---------------------------------------------------------------- */
  const gap = definition.gap * canvas.height;
  const stack =
    flowing.reduce((total, { item }) => total + item.height, 0) +
    gap * (flowing.length - 1);

  const available = band.bottom - band.top - margin * 2;
  let cursor: number;
  if (stack > available) {
    // The stack is taller than the band — which happens the moment an OVERSIZED
    // element is in it, and is allowed. Centring is the only placement that
    // keeps the overflow symmetric; anchoring top or bottom would throw all of
    // it off one edge.
    cursor = bandCentre(band) - stack / 2;
  } else if (definition.vertical === 'top') {
    cursor = band.top + margin;
  } else if (definition.vertical === 'bottom') {
    cursor = band.bottom - margin - stack;
  } else {
    cursor = bandCentre(band) - stack / 2;
  }

  for (const { item, index } of flowing) {
    const anchors = item.anchors ?? { h: 'center', v: 'center' };
    placements[index] = {
      cx: anchorX(anchors.h, item.width, canvas),
      cy: cursor + item.height / 2,
    };
    cursor += item.height + gap;
  }

  return placements;
};

/**
 * Push overlapping elements apart.
 *
 * A safety net, not a layout strategy: flowed stacks cannot collide by
 * construction, but two elements that both ask for CENTER can, and two blocks
 * of display type on top of each other is the one thing that reads
 * unambiguously as a bug rather than as a choice.
 *
 * Later elements give way to earlier ones — reading order again — and elements
 * placed by explicit coordinates are never moved.
 */
export const separate = (
  items: FlowItem[],
  placements: Placement[],
  canvas: VideoConfig = CANVAS,
): Placement[] => {
  const out = placements.map((placement) => ({ ...placement }));
  const AIR = canvas.height * 0.012;

  for (let i = 1; i < items.length; i++) {
    if (items[i].fixed) continue;
    for (let j = 0; j < i; j++) {
      const a = items[j];
      const b = items[i];
      const overlapX =
        Math.abs(out[i].cx - out[j].cx) < (a.width + b.width) / 2;
      const gapY = Math.abs(out[i].cy - out[j].cy);
      const needed = (a.height + b.height) / 2 + AIR;
      if (!overlapX || gapY >= needed) continue;

      // Move along the axis it already leans on, so a nudge never flips an
      // element to the wrong side of the composition.
      const below = out[i].cy >= out[j].cy;
      out[i].cy = out[j].cy + (below ? needed : -needed);
    }
  }

  return out;
};
