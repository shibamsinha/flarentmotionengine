/**
 * The splash lockup's motion, measured from the approved animation.
 *
 * Source: `reference/splash.mp4` — 1080×1920, 30fps, 75 frames (2.500s). Every
 * number below was read off that file with NumPy rather than estimated: the two
 * green capsules were separated from the wordmark by hue (G−B > 30), the
 * wordmark by neutrality (|R−B| ≤ 24), and each was tracked frame by frame.
 * The raw series is in the commit message for this change.
 *
 * Geometry at rest (frame coordinates):
 *
 *     lockup    x  82–997   w 916   (centred: 82 + 916/2 = 540 = frame centre)
 *     mark      x  82–198   116×116 (aspect 1.000, matching logo.png's 1.039)
 *     wordmark  x 213–997   785×87
 *
 * so the mark is 12.66% of the lockup, the gap 1.53%, the wordmark 85.70%.
 * Those three ratios are what this module exports, because the splash has to
 * work at whatever width a desktop window gives it, not at 1080px.
 *
 * The mark's travel needs no constant of its own: it starts centred in the
 * frame and ends at the lockup's left edge, and the lockup is itself centred,
 * so the distance is exactly half the leftover width. Measured 482 → 82 = 400;
 * (916 − 116) / 2 = 400. They agree, which is the check that the reading of the
 * layout is right.
 *
 * Timing was fitted by grid search over cubic-bezier space against the measured
 * per-frame positions:
 *
 *     mark slide      f9  + 31f   cubic-bezier(0.25, 0.9, 0.5, 1)   rms 0.70px
 *     wordmark wipe   f12 + 33f   cubic-bezier(0.25, 1.1, 0.3, 1)   rms 4.10px
 *
 * 0.70px of error across a 400px travel is below the source's own H.264
 * quantisation. The wordmark's 4.10px is larger because its right edge can only
 * be measured where there is ink — the bounding box cannot advance while the
 * wipe front crosses a word space — so it is as tight as the source allows.
 *
 * Neither curve is one of the house curves in `easing.ts`; `EASE.settle`
 * (0.16, 1, 0.3, 1) fits the mark slide at rms 11.8px, sixteen times worse. The
 * splash was authored elsewhere and is not obliged to share the reel's easing,
 * so these live here rather than being forced into `EASE`.
 *
 * Consumed as CSS custom properties by `.splash` in `index.css` — the animation
 * itself is plain CSS with these exact beziers, so nothing ticks in JS.
 */

/** Fractions of the lockup's width. They sum to 1. */
export const SPLASH_RATIO = {
  mark: 116 / 916,
  gap: 14 / 916,
  wordmark: 785 / 916,
} as const;

/** Milliseconds, converted from the source's 30fps frame numbers. */
export const SPLASH_TIMING = {
  /** Mark alone, centred, holding. No fade-in — it is at full opacity on f0. */
  markStart: 300,
  markDuration: 1033,
  /** The wordmark wipe begins while the mark is still travelling. */
  wordStart: 400,
  wordDuration: 1100,
  /**
   * The fade to the start screen. Measured peak luminance falls 255 → 0 over
   * f69.4–f74.0 on a straight line (slope −0.178/frame, r² > 0.999), so this is
   * linear rather than eased, and lands inside the 250ms the brief allows.
   */
  fadeStart: 2320,
  fadeDuration: 180,
  /** Total, matching the source exactly. */
  total: 2500,
} as const;

export const SPLASH_EASE = {
  mark: 'cubic-bezier(0.25, 0.9, 0.5, 1)',
  wordmark: 'cubic-bezier(0.25, 1.1, 0.3, 1)',
} as const;
