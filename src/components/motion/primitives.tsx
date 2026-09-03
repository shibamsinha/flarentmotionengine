/**
 * Reusable motion primitives.
 *
 * Every animation style is assembled from these four pieces:
 *   ENTER          — the house entrance timings, in seconds
 *   enterValues()  — opacity / translate / scale / blur for a given frame
 *   <MotionSpan>   — applies those values to a word without disturbing layout
 *   <TypeBlock>    — places a planned block on the canvas, ink-centred
 *
 * A new animation style should only ever need to compose these.
 */

import React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { blockLeft } from '../../utils/plan';
import type { BlockLayout, PlannedLine, PlannedWord } from '../../utils/plan';
import { clamp01, easeByName, EASE, type EaseName } from '../../utils/easing';
import {
  NO_BLUR,
  addBlur,
  hasBlur,
  velocityBlur,
  type BlurVector,
} from '../../utils/motionBlur';
import { carryOffset, type SceneTransition } from '../../utils/transition';
import { FONT_STACK, trackingFor } from '../../utils/typography';
import type { ResolvedStyle } from '../../utils/visualStyle';
import { StyledText } from './StyledText';

/**
 * House entrance timings, in seconds. Fitted to the reference reel: transforms
 * settle in ~0.30s, opacity resolves a little sooner, blur burns off first so
 * the word is legible before it stops moving.
 */
export const ENTER = {
  transform: 0.3,
  opacity: 0.22,
  blur: 0.18,
} as const;

/**
 * How long each style's entrance takes, in seconds.
 *
 * The single source of truth for "when has this finished arriving?" — the style
 * components below read it for their own `transformFrames`, and the editor
 * reads it to chain one element's entrance onto the end of the previous one.
 * Without it the editor would need its own copy of these numbers, and the two
 * would drift the first time a curve was retuned.
 *
 * SLIDE varies with direction (horizontal travels further, so takes longer);
 * the value here is the horizontal case, which is the right one for scheduling
 * because it is the upper bound.
 */
export const ENTER_SECONDS = {
  punch: ENTER.transform,
  massive: ENTER.transform * 1.35,
  slide: ENTER.transform * 1.1,
  stack: 0.11,
  rapid: ENTER.transform,
} as const;

export type MotionValues = {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  blur: number;
  rotate: number;
};

export const IDENTITY: MotionValues = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  blur: 0,
  rotate: 0,
};

export type EnterSpec = {
  /** Frame the entrance begins on. */
  start?: number;
  fromX?: number;
  fromY?: number;
  fromScale?: number;
  fromRotate?: number;
  /** Peak blur in px, burned off to zero. */
  blur?: number;
  /** Durations in frames. Callers convert from ENTER using the real fps. */
  transformFrames?: number;
  opacityFrames?: number;
  blurFrames?: number;
  transformEase?: EaseName;
  opacityEase?: EaseName;
  blurEase?: EaseName;
};

/**
 * Position, scale and opacity are driven by *different* curves on purpose.
 * In the reference, position collapses exponentially while opacity resolves
 * almost linearly — running both off one curve is the tell of a template.
 */
export const enterValues = (frame: number, spec: EnterSpec): MotionValues => {
  const start = spec.start ?? 0;
  const tFrames = spec.transformFrames ?? 9;
  const oFrames = spec.opacityFrames ?? 7;
  const bFrames = spec.blurFrames ?? 6;

  const transformEase = easeByName(spec.transformEase ?? 'settle');
  const opacityEase = easeByName(spec.opacityEase ?? 'reveal');
  const blurEase = easeByName(spec.blurEase ?? 'focus');

  const tp = transformEase(clamp01((frame - start) / Math.max(1, tFrames)));
  const op = opacityEase(clamp01((frame - start) / Math.max(1, oFrames)));
  const bp = blurEase(clamp01((frame - start) / Math.max(1, bFrames)));

  return {
    opacity: op,
    x: (spec.fromX ?? 0) * (1 - tp),
    y: (spec.fromY ?? 0) * (1 - tp),
    scale: 1 + ((spec.fromScale ?? 1) - 1) * (1 - tp),
    rotate: (spec.fromRotate ?? 0) * (1 - tp),
    blur: (spec.blur ?? 0) * (1 - bp),
  };
};

export type ExitSpec = {
  /** Frame the exit begins on (local to the exit window). */
  start?: number;
  /** Length of the exit, in frames. */
  frames: number;
  toX?: number;
  toY?: number;
  toScale?: number;
  toRotate?: number;
  /** Opacity the word is allowed to fall to. Movement should read first. */
  toOpacity?: number;
  ease?: EaseName;
  fadeEase?: EaseName;
};

/**
 * The mirror of `enterValues`: a word leaving under its own momentum.
 *
 * Exits use ease-*in* curves so the word accelerates away. Reusing an entrance
 * curve here is the classic mistake — it decelerates, so the word looks like it
 * is being pulled off screen rather than leaving.
 *
 * Opacity deliberately trails the movement: a word that fades before it has
 * travelled reads as a crossfade, which is exactly the "text card" feel V2 is
 * getting rid of.
 */
export const exitValues = (frame: number, spec: ExitSpec): MotionValues => {
  const start = spec.start ?? 0;
  const frames = Math.max(1, spec.frames);
  const t = clamp01((frame - start) / frames);
  const move = easeByName(spec.ease ?? 'exit')(t);
  const fade = easeByName(spec.fadeEase ?? 'exitFade')(t);

  return {
    opacity: 1 - (1 - (spec.toOpacity ?? 0)) * fade,
    x: (spec.toX ?? 0) * move,
    y: (spec.toY ?? 0) * move,
    scale: 1 + ((spec.toScale ?? 1) - 1) * move,
    rotate: (spec.toRotate ?? 0) * move,
    blur: 0,
  };
};

/** Compose two sets of motion values (e.g. an entrance plus a slow drift). */
export const combine = (a: MotionValues, b: Partial<MotionValues>): MotionValues => ({
  opacity: a.opacity * (b.opacity ?? 1),
  x: a.x + (b.x ?? 0),
  y: a.y + (b.y ?? 0),
  scale: a.scale * (b.scale ?? 1),
  blur: a.blur + (b.blur ?? 0),
  rotate: a.rotate + (b.rotate ?? 0),
});

/**
 * Scale how far a motion travels, without changing its shape in time.
 *
 * Every entrance in the engine decays to rest, so scaling the *deviation from
 * rest* turns one curve into a stronger or gentler version of itself. That is
 * what lets an EMPHASIS element hit harder and a SUPPORT line barely move while
 * both stay on their style's own curve — the alternative, a second set of
 * per-role curves, would put the same timing in five more places.
 *
 * Opacity is left alone: it resolves 0 → 1 whatever the role.
 */
export const amplify = (v: MotionValues, gain: number): MotionValues =>
  gain === 1
    ? v
    : {
        opacity: v.opacity,
        x: v.x * gain,
        y: v.y * gain,
        scale: 1 + (v.scale - 1) * gain,
        blur: v.blur * gain,
        rotate: v.rotate * gain,
      };

export const toTransform = (v: MotionValues): string => {
  const parts = [`translate3d(${v.x.toFixed(3)}px, ${v.y.toFixed(3)}px, 0)`];
  if (v.scale !== 1) parts.push(`scale(${v.scale.toFixed(5)})`);
  if (v.rotate !== 0) parts.push(`rotate(${v.rotate.toFixed(4)}deg)`);
  return parts.join(' ');
};

/* -------------------------------------------------------------------- span */

let filterSeq = 0;

/**
 * A word, with optional directional motion blur.
 *
 * The smear is an inline `feGaussianBlur` with a two-axis stdDeviation rather
 * than a CSS `blur()`, because CSS can only blur isotropically — which looks
 * like the camera lost focus, not like the type is moving. The filter region is
 * widened well past the element so a heavy smear is not clipped at its own box.
 *
 * When nothing is moving no filter is emitted at all, so held type is pixel
 * sharp and costs nothing.
 */
export const MotionSpan: React.FC<{
  values: MotionValues;
  children: ReactNode;
  style?: CSSProperties;
  origin?: string;
  /** Directional smear for this frame. */
  blur?: BlurVector;
}> = ({ values, children, style, origin = 'center center', blur }) => {
  const isotropic = values.blur > 0.05 ? values.blur : 0;
  const vector = addBlur(blur ?? NO_BLUR, isotropic);
  const smeared = hasBlur(vector);

  // Stable within a render pass; ids only need to be unique in the document.
  const id = React.useMemo(() => `fb${(filterSeq += 1)}`, []);

  return (
    <span
      style={{
        display: 'inline-block',
        opacity: values.opacity,
        transform: toTransform(values),
        transformOrigin: origin,
        filter: smeared ? `url(#${id})` : undefined,
        willChange: 'transform, opacity, filter',
        ...style,
      }}
    >
      {smeared ? (
        <svg
          width="0"
          height="0"
          style={{ position: 'absolute', pointerEvents: 'none' }}
          aria-hidden
        >
          <filter
            id={id}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${vector.sx.toFixed(2)} ${vector.sy.toFixed(2)}`}
            />
          </filter>
        </svg>
      ) : null}
      {children}
    </span>
  );
};

/* --------------------------------------------------------------- type block */

const textAlignToCss = (
  align: import('../../types/scene').Alignment,
): CSSProperties['textAlign'] => align;

/**
 * How an animation draws one word.
 *
 * `glyph` is the word already painted in its visual style — that third argument
 * is the V4 seam. An animation component drops it inside its `<MotionSpan>` and
 * never learns whether it is solid, outlined, a gradient or split; without it,
 * five animations × four styles would be twenty things to maintain.
 */
/**
 * A word's own colour, applied over its resolved style.
 *
 * Each style answers "make this word red" differently, and the answers are
 * chosen so the result is what the author would have expected:
 *
 *   SOLID     the fill becomes the colour
 *   OUTLINE   the stroke becomes the colour; it stays an outline
 *   GRADIENT  collapses to a solid in that colour — a gradient is a *set* of
 *             colours, so keeping it while also honouring one specific colour
 *             is not possible, and picking a colour is the more explicit
 *             instruction of the two
 *   SPLIT     every part takes the colour, which is what makes a split word
 *             read as one word again
 *
 * Applied here rather than inside `StyledText` because this is the one place
 * that knows which word it is looking at. StyledText remains the only place a
 * glyph is painted, which is the V4 rule.
 */
const recolour = (
  style: ResolvedStyle,
  wordColors: Record<string, string> | undefined,
  text: string,
): ResolvedStyle => {
  if (!wordColors) return style;
  // Strip the punctuation an author would not have typed into the colour map,
  // so "CUSTOMERS." matches a rule written for "customers".
  const bare = text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const colour = wordColors[bare] ?? wordColors[text.toLowerCase()];
  if (!colour) return style;

  if (style.type === 'gradient') {
    return { ...style, type: 'solid', fill: colour, gradient: null, parts: [] };
  }

  return {
    ...style,
    // A null fill is OUTLINE's transparent centre — recolouring it would fill
    // in the letter and stop it being an outline at all.
    fill: style.fill === null ? null : colour,
    stroke: style.stroke ? { ...style.stroke, color: colour } : null,
    parts: style.parts.map((part) => ({
      ...part,
      fill: part.fill === null ? null : colour,
      stroke: part.stroke ? { ...part.stroke, color: colour } : null,
      gradient: null,
      type: part.type === 'gradient' ? ('solid' as const) : part.type,
    })),
  };
};

export type WordRenderer = (
  word: PlannedWord,
  line: PlannedLine,
  glyph: ReactNode,
) => ReactNode;

/**
 * Places a planned block where the planner put it, then hands each word to the
 * caller. Line boxes use line-height 1; the planner has already compensated for
 * ascender/descender space.
 *
 * V3 reads `block.left` rather than deriving a position from an alignment. An
 * element may sit anywhere — including past the frame edge — and a three-way
 * left/centre/right rule cannot say that.
 */
export const TypeBlock: React.FC<{
  block: BlockLayout;
  color: string;
  /** How the type is painted. Resolved against this frame's field colour. */
  visual?: ResolvedStyle;
  /**
   * Per-word colour, keys lower-cased. Recolours a word without changing how
   * it is painted otherwise — an outlined word stays outlined, a gradient word
   * keeps its gradient and only its stops move to the chosen colour.
   *
   * Applied here rather than inside `StyledText` because this is the one place
   * that knows which word it is looking at; StyledText stays the single place
   * a glyph is *painted*, which is the V4 rule.
   */
  wordColors?: Record<string, string>;
  renderWord: WordRenderer;
  /** Applied to the whole block — used by SLIDE / PUNCH / MASSIVE. */
  values?: MotionValues;
  /** Block-level directional smear, when the whole composition is moving. */
  blur?: BlurVector;
  origin?: string;
}> = ({
  block,
  color,
  visual,
  wordColors,
  renderWord,
  values,
  blur,
  origin = 'center center',
}) => {
  if (block.lines.length === 0) return null;

  const v = values ?? IDENTITY;
  const vector = addBlur(blur ?? NO_BLUR, v.blur > 0.05 ? v.blur : 0);
  const smeared = hasBlur(vector);
  const filterId = `bb${(filterSeq += 1)}`;

  return (
    <div
      style={{
        position: 'absolute',
        top: block.top,
        left: block.left,
        width: block.width,
        color,
        fontFamily: FONT_STACK,
        transform: toTransform(v),
        transformOrigin: origin,
        opacity: v.opacity,
        filter: smeared ? `url(#${filterId})` : undefined,
        willChange: 'transform, opacity, filter',
      }}
    >
      {smeared ? (
        <svg
          width="0"
          height="0"
          style={{ position: 'absolute', pointerEvents: 'none' }}
          aria-hidden
        >
          <filter
            id={filterId}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur
              stdDeviation={`${vector.sx.toFixed(2)} ${vector.sy.toFixed(2)}`}
            />
          </filter>
        </svg>
      ) : null}
      {block.lines.map((line) => {
        // Where this line sits inside the block, so a gradient can be sized to
        // the whole element and offset per word rather than restarting on each.
        const lineOffset =
          line.align === 'left'
            ? 0
            : line.align === 'right'
              ? block.width - line.width
              : (block.width - line.width) / 2;
        return (
        <div
          key={line.id}
          style={{
            position: 'absolute',
            top: line.top,
            left: 0,
            width: block.width,
            fontSize: line.fontSize,
            fontWeight: line.weight,
            letterSpacing: trackingFor(line.fontSize),
            lineHeight: 1,
            textAlign: textAlignToCss(line.align),
            whiteSpace: 'pre',
            fontKerning: 'normal',
            textRendering: 'geometricPrecision',
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          {line.words.map((word, index) => (
            <React.Fragment key={word.id}>
              {index > 0 ? ' ' : null}
              {renderWord(
                word,
                line,
                visual ? (
                  <StyledText
                    text={word.text}
                    style={recolour(visual, wordColors, word.text)}
                    fontSize={word.fontSize}
                    box={{
                      width: block.width,
                      height: Math.max(1, block.height),
                      offsetX: lineOffset + word.x,
                      offsetY: line.top,
                    }}
                    wordIndex={index}
                    wordCount={line.words.length}
                  />
                ) : (
                  word.text
                ),
              )}
            </React.Fragment>
          ))}
        </div>
        );
      })}
    </div>
  );
};

/**
 * A word that exists in both scenes, travelling from where it was to where it
 * now lives.
 *
 * Opacity is pinned at 1: the word is already on screen, so fading it in would
 * blink it out for a frame at the seam — which is precisely the hard cut V2 is
 * removing. Only position and scale move.
 */
export const carryValues = (
  frame: number,
  frames: number,
  offset: { x: number; y: number; scale: number },
): MotionValues => ({
  ...enterValues(frame, {
    fromX: offset.x,
    fromY: offset.y,
    fromScale: offset.scale,
    transformFrames: frames,
    opacityFrames: 1,
    blurFrames: 1,
    transformEase: 'carry',
  }),
  opacity: 1,
  blur: 0,
});

/* ------------------------------------------------------------ style block */

export type StyleMotion = {
  /**
   * The whole composition's entrance, used when nothing is being carried over
   * from the previous scene.
   */
  block: (frame: number) => MotionValues;
  /**
   * A single word's entrance, used in continuity mode where the block is held
   * still so carried words can travel independently.
   */
  word: (frame: number, word: PlannedWord) => MotionValues;
  /** How much velocity smear this style is allowed. */
  gain: number;
  /** Length of the style's entrance, in frames. */
  frames: number;
  /** The curve that entrance runs on. */
  ease?: EaseName;
};

/**
 * Renders a planned block with V2 transition behaviour.
 *
 * Two modes, and the switch between them is the heart of the upgrade:
 *
 *  - **No carry** — the block moves as one object, which is what makes PUNCH
 *    and MASSIVE land as a single composition.
 *  - **Continuity** — the incoming scene shares words with the outgoing one, so
 *    the block is pinned and every word animates for itself. Shared words travel
 *    from where they already were; new words use the style's own entrance.
 *
 * Pinning the block in continuity mode is what keeps this honest: a carried word
 * riding a block transform *and* its own carry transform would arrive from two
 * places at once, and cancelling one against the other is the kind of maths that
 * silently drifts.
 */
export const StyleBlock: React.FC<{
  element: import('../../utils/plan').PlannedElement;
  frame: number;
  color: string;
  /** How this element is painted. Passed straight through — never inspected. */
  visual?: ResolvedStyle;
  motion: StyleMotion;
  transition?: SceneTransition;
  origin?: string;
}> = ({ element, frame, color, visual, motion, transition, origin }) => {
  const carried = transition?.carried;
  const continuity = (carried?.size ?? 0) > 0 && (transition?.carryFrames ?? 0) > 0;

  /**
   * Role amplitude and an optional offscreen origin are folded in here rather
   * than in each style, so all five inherit both without a line of their own.
   *
   * `from` decays over the style's *own* entrance window on the style's own
   * curve — which is why `StyleMotion` reports `frames` and `ease`. An element
   * told to enter from OFFSCREEN_LEFT therefore travels in exactly as far as it
   * was asked to and settles exactly when the rest of the style does.
   */
  const travelEase = easeByName(motion.ease ?? 'settle');
  const shaped = (at: (f: number) => MotionValues) => (f: number) => {
    // A delayed element's whole entrance is shifted, not just its words: before
    // its delay the block sits in its pre-entrance state at zero opacity, which
    // is what staggering a composition actually means.
    const base = amplify(at(f - element.delay), element.motion);
    if (!element.from) return base;
    const t = travelEase(clamp01((f - element.delay) / Math.max(1, motion.frames)));
    return {
      ...base,
      x: base.x + element.from.x * (1 - t),
      y: base.y + element.from.y * (1 - t),
    };
  };

  const blockMotion = shaped(motion.block);
  const blockValues = continuity ? IDENTITY : blockMotion(frame);
  const blockBlur = continuity
    ? NO_BLUR
    : velocityBlur(blockMotion, frame, element.block.heroSize, motion.gain);

  return (
    <TypeBlock
      block={element.block}
      color={color}
      visual={visual}
      // The element already carries its resolved colours, so StyleBlock needs
      // no prop of its own — one fewer thing for a caller to forget.
      wordColors={element.wordColors}
      values={blockValues}
      blur={blockBlur}
      origin={origin}
      renderWord={(word, _line, glyph) => {
        const source = carried?.get(word.id);

        if (source && transition) {
          const offset = carryOffset(word, source);
          const carry = (f: number) => carryValues(f, transition.carryFrames, offset);
          return (
            <MotionSpan
              values={carry(frame)}
              blur={velocityBlur(carry, frame, word.fontSize, motion.gain)}
            >
              {glyph}
            </MotionSpan>
          );
        }

        // The block is already carrying this word's motion. Compared against
        // the element's delay rather than against zero: a staggered element's
        // words all start at its delay, and testing for 0 would animate them a
        // second time on top of the block.
        if (!continuity && word.start === element.delay) {
          return <MotionSpan values={IDENTITY}>{glyph}</MotionSpan>;
        }

        // Cross-movement only applies in continuity mode: outside it the block
        // itself is travelling, and adding a second offset would double it up.
        const cross = continuity ? transition?.cross : undefined;
        const crossFrames = transition?.carryFrames ?? 1;
        const enter = (f: number) => {
          const base = motion.word(f, word);
          if (!cross || (cross.x === 0 && cross.y === 0)) return base;
          const settled = easeByName('slideEnter')(clamp01(f / Math.max(1, crossFrames)));
          return {
            ...base,
            x: base.x + cross.x * (1 - settled),
            y: base.y + cross.y * (1 - settled),
          };
        };
        return (
          <MotionSpan
            values={enter(frame)}
            blur={velocityBlur(enter, frame, word.fontSize, motion.gain)}
          >
            {glyph}
          </MotionSpan>
        );
      }}
    />
  );
};

/** Shared props every motion style receives. */
export type MotionProps = {
  plan: import('../../utils/plan').ScenePlan;
  /**
   * The piece of type this instance is animating. A V2 scene has exactly one and
   * it is the whole scene; a V3 scene renders one style component per element,
   * which is what lets three phrases in one frame move independently.
   */
  element: import('../../utils/plan').PlannedElement;
  /** Frame local to the scene. */
  frame: number;
  fps: number;
  durationInFrames: number;
  color: string;
  /**
   * How this element is painted, resolved against the field colour for this
   * frame. Animation components forward it and never read it — that is the V4
   * rule that keeps animation and style independent.
   */
  visual?: ResolvedStyle;
  /**
   * The seam with the previous scene: how long the overlap is and which words
   * are being carried across it. Absent on the first scene.
   */
  transition?: SceneTransition;
  /**
   * The project's frame. Styles whose throw is expressed as a fraction of
   * frame width/height (SLIDE's travel, MASSIVE's drift) read this instead of
   * the portrait default, so landscape gets its own proportionate throw rather
   * than portrait's numbers stretched onto a wider frame.
   */
  canvas: import('../../types/scene').VideoConfig;
};

export const framesFor = (seconds: number, fps: number): number =>
  Math.max(1, Math.round(seconds * fps));

export { EASE, blockLeft };
export type { EaseName };
