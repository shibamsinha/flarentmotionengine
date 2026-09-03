/**
 * STYLE 01 — MASSIVE
 *
 * A word starts small and takes the frame in one aggressive move. Sizing lets
 * it run past the edges (short words target 1.08 × frame width), which is one
 * of the reference's defining habits: the eye reads the shape before the word.
 *
 * V2: the scale runs on `massiveEnter`, the most front-loaded curve in the set —
 * nearly full size a third of the way in, then a long settle. Blur is no longer
 * a timer; it comes from how fast the edges are actually travelling, so the
 * violent head of the move streaks and the held frame is razor sharp.
 */

import React from 'react';
import { EASE, clamp01 } from '../../utils/easing';
import { BLUR_GAIN } from '../../utils/motionBlur';
import {
  ENTER,
  ENTER_SECONDS,
  StyleBlock,
  combine,
  enterValues,
  framesFor,
  type MotionProps,
} from './primitives';

export const Massive: React.FC<MotionProps> = ({
  element,
  frame,
  fps,
  durationInFrames,
  color,
  visual,
  transition,
  canvas,
}) => {
  const transformFrames = framesFor(ENTER_SECONDS.massive, fps);
  const blurFrames = framesFor(ENTER.blur, fps);
  const opacityFrames = framesFor(ENTER.opacity * 0.7, fps);

  // A slow push after the settle. 2.5% over the whole shot reads as intent,
  // not as an effect — remove it and the held frame goes flat.
  const driftStart = transformFrames;
  const driftSpan = Math.max(1, durationInFrames - driftStart);

  const block = (f: number) => {
    const entrance = enterValues(f, {
      fromScale: 0.34,
      fromY: canvas.height * 0.025,
      blur: 5,
      transformFrames,
      opacityFrames,
      blurFrames,
      transformEase: 'massiveEnter',
    });
    const drift = EASE.inOut(clamp01((f - driftStart) / driftSpan));
    return combine(entrance, { scale: 1 + 0.025 * drift });
  };

  return (
    <StyleBlock
      element={element}
      frame={frame}
      color={color}
      visual={visual}
      transition={transition}
      motion={{
        block,
        frames: transformFrames,
        ease: 'massiveEnter',
        // Support words resolve just after the hero so the eye lands on scale
        // first and reads the qualifier second.
        word: (f, word) =>
          enterValues(f, {
            start: word.start,
            fromScale: word.role === 'hero' ? 0.34 : 1,
            fromY:
              word.role === 'hero' ? canvas.height * 0.025 : word.fontSize * 0.35,
            transformFrames,
            opacityFrames,
            blurFrames,
            transformEase: 'massiveEnter',
          }),
        gain: BLUR_GAIN.massive,
      }}
    />
  );
};
