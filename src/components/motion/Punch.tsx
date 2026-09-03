/**
 * STYLE 02 — PUNCH
 *
 * The reference's workhorse: the word arrives just under size, resolves to 100%
 * with a small overshoot, and blur burns off ahead of the movement.
 *
 * V2: 0.85 → ~1.06 → 1.00 on `punchEnter`. The overshoot is impact, not bounce —
 * it crosses 100% exactly once and settles. The whole event is under a third of
 * a second; anything slower reads as a presentation transition.
 */

import React from 'react';
import { BLUR_GAIN } from '../../utils/motionBlur';
import {
  ENTER,
  ENTER_SECONDS,
  StyleBlock,
  enterValues,
  framesFor,
  type MotionProps,
} from './primitives';

export const Punch: React.FC<MotionProps> = ({
  element,
  frame,
  fps,
  color,
  visual,
  transition,
}) => {
  const transformFrames = framesFor(ENTER_SECONDS.punch, fps);
  const opacityFrames = framesFor(ENTER.opacity * 0.75, fps);
  const blurFrames = framesFor(ENTER.blur * 0.8, fps);

  return (
    <StyleBlock
      element={element}
      frame={frame}
      color={color}
      visual={visual}
      transition={transition}
      motion={{
        frames: transformFrames,
        ease: 'punchEnter',
        block: (f) =>
          enterValues(f, {
            fromScale: 0.85,
            blur: 3,
            transformFrames,
            opacityFrames,
            blurFrames,
            transformEase: 'punchEnter',
          }),
        // Support words trail the hero by a beat — measured in the reference,
        // where "worth making" resolves after "comparison".
        word: (f, word) =>
          enterValues(f, {
            start: word.start,
            fromScale: word.role === 'hero' ? 0.85 : 0.94,
            fromY: word.role === 'hero' ? 0 : word.fontSize * 0.28,
            transformFrames,
            opacityFrames,
            blurFrames,
            transformEase: 'punchEnter',
          }),
        gain: BLUR_GAIN.punch,
      }}
    />
  );
};
