/**
 * Easing primitives.
 *
 * The named FLARENT curves were fitted to the reference reel. Sampling the
 * centroid of the type on every frame of `reference/Video-48028.mp4` showed
 * that the distance-to-rest halves roughly every frame (ratio ~0.49) and
 * settles in ~7 frames at 24fps — an exponential decay that
 * `cubic-bezier(0.16, 1, 0.3, 1)` reproduces almost exactly.
 *
 * Opacity in the reference follows a noticeably *flatter* curve than position
 * (measured 0.15 / 0.44 / 0.67 / 0.84 / 0.97 over six frames), which is why
 * `reveal` exists separately from `settle`. Driving both from one curve is the
 * single biggest tell of a generic template.
 */

export type EaseFn = (t: number) => number;

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const linear: EaseFn = (t) => t;

export const easeInQuad: EaseFn = (t) => t * t;
export const easeOutQuad: EaseFn = (t) => 1 - (1 - t) * (1 - t);
export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuart: EaseFn = (t) => 1 - Math.pow(1 - t, 4);
export const easeOutQuint: EaseFn = (t) => 1 - Math.pow(1 - t, 5);
export const easeOutExpo: EaseFn = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export const easeInOutQuad: EaseFn = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeInOutQuart: EaseFn = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

/**
 * A CSS-compatible cubic-bezier(x1, y1, x2, y2) solver.
 * Newton-Raphson with a bisection fallback — the same approach browsers use.
 */
export const cubicBezier = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EaseFn => {
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number) => 3 * b - 6 * a;
  const C = (a: number) => 3 * a;

  const calc = (t: number, a: number, b: number) =>
    ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) =>
    3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (d === 0) break;
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) return calc(t, y1, y2);
      t -= err / d;
    }

    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) break;
      if (err > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return calc(t, y1, y2);
  };
};

/**
 * The house curves. Everything in the engine references these by name so the
 * whole reel can be re-timed from one place.
 */
export const EASE = {
  /** Transform settle — the signature Flarent decay. */
  settle: cubicBezier(0.16, 1, 0.3, 1),
  /** Opacity. Deliberately flatter than `settle`. */
  reveal: cubicBezier(0.33, 0, 0.2, 1),
  /** Blur burn-off — front loaded so type reads early. */
  focus: cubicBezier(0.22, 0.9, 0.24, 1),
  /** PUNCH: a 1–2% overshoot, nothing more. Never a bounce. */
  punch: cubicBezier(0.19, 1.24, 0.36, 1),
  /** MASSIVE: aggressive at the head, glassy at the tail. */
  massive: cubicBezier(0.1, 0.86, 0.16, 1),
  /** SLIDE: carries momentum further into the frame than `settle`. */
  glide: cubicBezier(0.2, 1.05, 0.26, 1),
  /** Symmetric — for drifts and exits. */
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  linear,

  /* ------------------------------------------------------- V2 style curves */

  /**
   * One curve per style, so no two styles resolve the same way. The tell of a
   * template is every element easing identically; these are tuned per style and
   * referenced by name so the values live in exactly one place.
   */

  /** PUNCH — quick out, ~6% overshoot, settles hard. 85 → 106 → 100. */
  punchEnter: cubicBezier(0.18, 1.42, 0.36, 1),
  /** MASSIVE — violent head, long glassy tail. Scale must *accelerate* away. */
  massiveEnter: cubicBezier(0.06, 0.92, 0.12, 1),
  /** SLIDE — weighted travel with a small overshoot past centre. */
  slideEnter: cubicBezier(0.16, 1.12, 0.24, 1),
  /** STACK — clean and coordinated; no per-word personality. */
  stackEnter: cubicBezier(0.2, 0.9, 0.28, 1),
  /** RAPID — near-instant. Anything smoother makes a staccato run sluggish. */
  rapidEnter: cubicBezier(0.3, 1, 0.35, 1),

  /**
   * Exits accelerate *away*: an entrance decelerates into rest, so an exit that
   * used the same curve would look like the word was being pulled back. These
   * are ease-in, which is what makes a word feel like it leaves under its own
   * momentum rather than being switched off.
   */
  exit: cubicBezier(0.55, 0, 0.85, 0.35),
  /** A harder exit for MASSIVE / SLIDE, where the word should really go. */
  exitHard: cubicBezier(0.7, 0, 0.9, 0.2),
  /**
   * Opacity on the way out. Front-loaded on purpose: when a big word replaces
   * another in the same part of the frame, two half-opaque words read as mush.
   * Dropping the outgoing early keeps one of them dominant at every instant
   * while the movement still does the transitional work.
   */
  exitFade: cubicBezier(0.2, 0.65, 0.45, 1),

  /** Carrying a shared word from its old position to its new one. */
  carry: cubicBezier(0.22, 1, 0.28, 1),
} satisfies Record<string, EaseFn>;

/** Per-style entrance curve. Keeps style identity in one lookup. */
export const ENTER_EASE = {
  massive: 'massiveEnter',
  punch: 'punchEnter',
  stack: 'stackEnter',
  slide: 'slideEnter',
  rapid: 'rapidEnter',
} as const;

/** Per-style exit curve. */
export const EXIT_EASE = {
  massive: 'exitHard',
  punch: 'exit',
  stack: 'exit',
  slide: 'exitHard',
  rapid: 'exit',
  /* NONE never animates out on its own, so this is only reached when a scene
     seam forces an overlap. `exit` is the gentlest curve available. */
  none: 'exit',
} as const;

export type EaseName = keyof typeof EASE;

export const easeByName = (name: EaseName | EaseFn): EaseFn =>
  typeof name === 'function' ? name : EASE[name];

export type TweenOptions = {
  /** Frame the tween begins on. */
  start: number;
  /** Length in frames. */
  duration: number;
  from: number;
  to: number;
  ease?: EaseName | EaseFn;
};

/** Frame-driven tween with clamped ends. */
export const tween = (frame: number, opts: TweenOptions): number => {
  const { start, duration, from, to } = opts;
  if (duration <= 0) return to;
  const t = clamp01((frame - start) / duration);
  const eased = easeByName(opts.ease ?? 'settle')(t);
  return from + (to - from) * eased;
};

/** Normalised 0..1 progress of `frame` through a window, eased. */
export const progress = (
  frame: number,
  start: number,
  duration: number,
  ease: EaseName | EaseFn = 'linear',
): number => {
  if (duration <= 0) return 1;
  return easeByName(ease)(clamp01((frame - start) / duration));
};
