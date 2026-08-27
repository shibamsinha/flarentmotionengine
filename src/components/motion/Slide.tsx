/**
 * STYLE 04 — SLIDE
 *
 * Type travels in from an edge and settles on `slideEnter` — a weighted curve
 * that carries a little past centre before coming back, so the move has mass.
 *
 * V2 cross-movement: the outgoing scene leaves *against* the incoming travel
 * (see `exitSpecFor`), so at a SLIDE seam the two pass each other rather than
 * one simply replacing the other.
 *
 * Vertical throw is ~6.8% of frame height — the value sampled from the
 * reference's "the only" and "is who you" shots. Horizontal throw is longer,
 * because sideways movement needs more distance to read as travel, and it
 * smears along its own axis on the way in.
 */

import React from 'react';
import type { SlideDirection, VideoConfig } from '../../types/scene';
import { BLUR_GAIN } from '../../utils/motionBlur';
import {
  ENTER,
  StyleBlock,
  enterValues,
  framesFor,
  type MotionProps,
} from './primitives';

const offsetFor = (
  direction: SlideDirection,
  canvas: VideoConfig,
): { x: number; y: number } => {
  const throwY = canvas.height * 0.068;
  const throwX = canvas.width * 0.42;
  switch (direction) {
    case 'left':
      return { x: -throwX, y: 0 };
    case 'right':
      return { x: throwX, y: 0 };
    case 'top':
      return { x: 0, y: -throwY };
    case 'bottom':
    default:
      return { x: 0, y: throwY };
  }
};

export const Slide: React.FC<MotionProps> = ({
  plan,
  element,
  frame,
  fps,
  color,
  visual,
  transition,
  canvas,
}) => {
  const direction = plan.scene.direction ?? 'bottom';
  const { x, y } = offsetFor(direction, canvas);
  const horizontal = direction === 'left' || direction === 'right';
  const transformFrames = framesFor(
    ENTER.transform * (horizontal ? 1.1 : 0.95),
    fps,
  );
  const opacityFrames = framesFor(ENTER.opacity * 0.7, fps);
  const blurFrames = framesFor(ENTER.blur, fps);

  return (
    <StyleBlock
      element={element}
      frame={frame}
      color={color}
      visual={visual}
      transition={transition}
      motion={{
        frames: transformFrames,
        ease: 'slideEnter',
        block: (f) =>
          enterValues(f, {
            fromX: x,
            fromY: y,
            transformFrames,
            opacityFrames,
            blurFrames,
            transformEase: 'slideEnter',
          }),
        word: (f, word) =>
          enterValues(f, {
            start: word.start,
            fromX: word.role === 'hero' ? x : x * 0.45,
            fromY: word.role === 'hero' ? y : y * 0.45 + word.fontSize * 0.2,
            transformFrames,
            opacityFrames,
            blurFrames,
            transformEase: 'slideEnter',
          }),
        gain: BLUR_GAIN.slide,
      }}
    />
  );
};
