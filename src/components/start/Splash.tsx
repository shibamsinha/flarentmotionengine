/**
 * The launch sequence.
 *
 * Black frame, the mark alone in the centre, then the mark travels left while
 * the wordmark wipes out from behind it, a hold, and a short fade into the
 * start screen. It is the approved animation from `reference/splash.mp4`,
 * rebuilt as UI rather than played as a video — see `utils/splashMotion.ts` for
 * the measurements and the fitted curves.
 *
 * Two decisions worth knowing:
 *
 * **The wordmark is an image, not text.** The lockup reads "Flarent Motion
 * Engine" but the brand asset only carries "Flarent Motion", and the brand
 * typeface has never been supplied. Setting the missing word in Inter would put
 * an obviously foreign letterform against the real logo, so
 * `scripts/splash-wordmark.mjs` cuts the wordmark out of the approved video
 * instead. If the typeface ever arrives this becomes live text and nothing else
 * changes.
 *
 * **Nothing ticks in JS.** The whole sequence is CSS animation with the fitted
 * beziers, so it cannot drop frames against a React render, and a single
 * timeout ends it. The clip is two nested elements because the wordmark's left
 * edge and right edge move on different curves with different delays — one
 * `clip-path` cannot carry two timings.
 */

import React, { useEffect, useRef } from 'react';
import { LOGO_MARK, SPLASH_WORDMARK } from '../editor/Logo';
import { SPLASH_EASE, SPLASH_RATIO, SPLASH_TIMING } from '../../utils/splashMotion';

export const Splash: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  // Kept in a ref so a re-render cannot restart the sequence or double-fire it.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    /**
     * Someone who has asked for reduced motion still needs the app to start, so
     * the sequence is skipped rather than slowed — sitting on a static logo for
     * 2.5s is a worse answer than going straight to the choice.
     */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => done.current(),
      still ? 600 : SPLASH_TIMING.total,
    );
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="splash"
      role="status"
      aria-label="Flarent Motion Engine"
      style={
        {
          '--mark-ratio': SPLASH_RATIO.mark,
          '--gap-ratio': SPLASH_RATIO.gap,
          '--word-ratio': SPLASH_RATIO.wordmark,
          '--mark-start': `${SPLASH_TIMING.markStart}ms`,
          '--mark-duration': `${SPLASH_TIMING.markDuration}ms`,
          '--word-start': `${SPLASH_TIMING.wordStart}ms`,
          '--word-duration': `${SPLASH_TIMING.wordDuration}ms`,
          '--fade-start': `${SPLASH_TIMING.fadeStart}ms`,
          '--fade-duration': `${SPLASH_TIMING.fadeDuration}ms`,
          '--mark-ease': SPLASH_EASE.mark,
          '--word-ease': SPLASH_EASE.wordmark,
        } as React.CSSProperties
      }
    >
      <div className="splash-lockup">
        <img className="splash-mark" src={LOGO_MARK} alt="" />
        {/* Outer element carries the left clip, which tracks the mark's
            trailing edge; the inner one carries the right clip, which is the
            wipe. Nested so each gets its own curve and delay. */}
        <div className="splash-word-clip">
          <img className="splash-word" src={SPLASH_WORDMARK} alt="" />
        </div>
      </div>
    </div>
  );
};
