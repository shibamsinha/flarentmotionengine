/**
 * Velocity-driven motion blur.
 *
 * V1 used a fixed blur that burned off on a timer — the same smear whether the
 * word was crawling or crossing the frame. V2 derives blur from how far the
 * word actually moves between this frame and the last, which is what makes a
 * fast slide smear and a settled word stay razor sharp.
 *
 * The blur is *directional*: an `feGaussianBlur` with a two-axis stdDeviation
 * smears along the axis of travel, so a horizontal slide blurs horizontally and
 * keeps its vertical edges crisp. A CSS `blur()` can only do a round smear,
 * which reads as "out of focus" rather than "moving fast".
 *
 * Everything is analytic — the motion functions are sampled at `frame` and
 * `frame - 1`. Nothing is re-rendered, so this costs one extra evaluation of a
 * cubic-bezier per word rather than a second pass over the scene.
 */

import type { MotionValues } from '../components/motion/primitives';

export type BlurVector = {
  /** Gaussian sigma along x and y, in composition px. */
  sx: number;
  sy: number;
};

export const NO_BLUR: BlurVector = { sx: 0, sy: 0 };

/**
 * Below this, movement is not fast enough to smear and blurring would just look
 * like a focus problem.
 */
const SPEED_FLOOR = 6;

/**
 * Never smear past this. A carried word crossing the frame during a transition
 * is the fastest thing the engine produces, and past roughly this much sigma it
 * stops reading as a word in motion and starts reading as a smudge.
 */
const MAX_SIGMA = 18;

/** px of travel per frame → sigma. Tuned against 30fps display type. */
const SPEED_TO_SIGMA = 0.3;

/**
 * A scale change moves every edge of the word outward at once, so it reads as
 * a radial smear. Converting it to an equivalent linear speed lets one model
 * cover both cases: MASSIVE's scale-up blurs, a static word does not.
 */
const SCALE_TO_SPEED = 0.42;

const softFloor = (speed: number): number =>
  speed <= SPEED_FLOOR ? 0 : speed - SPEED_FLOOR;

/**
 * Blur for one word this frame.
 *
 * @param at      the word's motion values as a pure function of frame
 * @param frame   current frame
 * @param extent  the word's on-screen size in px, used to turn a scale delta
 *                into a comparable edge speed
 * @param gain    per-style multiplier — RAPID wants almost none, MASSIVE wants
 *                the full amount
 */
export const velocityBlur = (
  at: (frame: number) => MotionValues,
  frame: number,
  extent: number,
  gain = 1,
): BlurVector => {
  if (gain <= 0 || frame <= 0) return NO_BLUR;

  const now = at(frame);
  const before = at(frame - 1);

  const dx = now.x - before.x;
  const dy = now.y - before.y;

  // Half-extent because scale grows about the centre: an edge travels half the
  // total width change.
  const edge = Math.abs(now.scale - before.scale) * extent * 0.5 * SCALE_TO_SPEED;

  const sx = Math.min(MAX_SIGMA, softFloor(Math.abs(dx) + edge) * SPEED_TO_SIGMA * gain);
  const sy = Math.min(MAX_SIGMA, softFloor(Math.abs(dy) + edge) * SPEED_TO_SIGMA * gain);

  return {
    sx: Number.isFinite(sx) && sx > 0.15 ? sx : 0,
    sy: Number.isFinite(sy) && sy > 0.15 ? sy : 0,
  };
};

export const hasBlur = (blur: BlurVector): boolean => blur.sx > 0.15 || blur.sy > 0.15;

/** Combine an entrance's own blur budget with the velocity-derived smear. */
export const addBlur = (a: BlurVector, isotropic: number): BlurVector =>
  isotropic <= 0.05 ? a : { sx: a.sx + isotropic, sy: a.sy + isotropic };

/** How much smear each style is allowed. */
export const BLUR_GAIN: Record<string, number> = {
  // The whole point of MASSIVE is speed; let it streak.
  massive: 1.15,
  punch: 0.85,
  slide: 1.1,
  stack: 0.7,
  // RAPID is built from hard cuts. Blur here would only muddy a sharp run.
  rapid: 0.25,
};
