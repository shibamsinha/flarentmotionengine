/**
 * STYLE 03 — STACK
 *
 * Words arrive one at a time and the last one dominates. The critical detail,
 * and the thing most kinetic-type templates get wrong: the layout is solved for
 * the *finished* phrase up front, so nothing already on screen ever moves when
 * the next word lands. The reference is pixel-identical frame to frame between
 * reveals — the words simply appear in their final position.
 *
 * V2: reveals stay near-instant, but every word now uses the same `stackEnter`
 * curve and the same lift. Coordination is the point of STACK — giving each word
 * its own personality here is what turns a build into a jumble.
 */

import React from 'react';
import type { BackgroundName, PaletteName } from '../../types/scene';
import { flipBackground } from '../../utils/typography';
import type { ScenePlan } from '../../utils/plan';
import { BLUR_GAIN, velocityBlur } from '../../utils/motionBlur';
import { carryOffset } from '../../utils/transition';
import {
  MotionSpan,
  TypeBlock,
  amplify,
  carryValues,
  ENTER_SECONDS,
  enterValues,
  framesFor,
  type MotionProps,
} from './primitives';

const HIDDEN = { opacity: 0, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 };
const SOLID = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 };

/** How many words have landed at `frame`. Drives the optional background flip. */
export const stackStepAt = (plan: ScenePlan, frame: number): number => {
  const words = plan.block.lines.flatMap((line) => line.words);
  let step = 0;
  for (const word of words) {
    if (frame >= word.start) step += 1;
  }
  return Math.max(0, step - 1);
};

/**
 * The reference cuts the background on every beat of its closing stack
 * (green "were" → cream "were never"). Opt in per scene.
 */
export const stackBackground = (
  plan: ScenePlan,
  frame: number,
  palette: PaletteName,
): BackgroundName => {
  if (!plan.scene.flipBackground) return plan.scene.background;
  return stackStepAt(plan, frame) % 2 === 1
    ? flipBackground(plan.scene.background, palette)
    : plan.scene.background;
};

export const Stack: React.FC<MotionProps> = ({
  element,
  frame,
  fps,
  color,
  visual,
  transition,
}) => {
  const transformFrames = framesFor(ENTER_SECONDS.stack, fps);
  const opacityFrames = framesFor(0.07, fps);
  const blurFrames = framesFor(0.06, fps);

  return (
    <TypeBlock
      block={element.block}
      color={color}
      visual={visual}
      wordColors={element.wordColors}
      renderWord={(word, _line, glyph) => {
        const source = transition?.carried.get(word.id);
        if (source && transition) {
          // Shared with the previous scene: slide into the new layout instead
          // of waiting for this word's build step.
          const offset = carryOffset(word, source);
          const carry = (f: number) => carryValues(f, transition.carryFrames, offset);
          return (
            <MotionSpan
              values={carry(frame)}
              blur={velocityBlur(carry, frame, word.fontSize, BLUR_GAIN.stack)}
            >
              {glyph}
            </MotionSpan>
          );
        }

        if (frame < word.start) {
          // Kept in the flow, not removed: the layout is solved for the whole
          // phrase up front so nothing on screen shifts when a word lands.
          return (
            <MotionSpan values={HIDDEN} style={{ visibility: 'hidden' }}>
              {glyph}
            </MotionSpan>
          );
        }

        // The word that opens the scene is a straight cut from whatever came
        // before — the cut is the transition. Only later words get the lift,
        // otherwise the scene would open on a blank frame. A staggered element
        // opens on its own delay rather than on frame zero.
        if (word.start === element.delay) {
          return <MotionSpan values={SOLID}>{glyph}</MotionSpan>;
        }

        const enter = (f: number) =>
          amplify(
            enterValues(f, {
              start: word.start,
              fromY: word.fontSize * (word.role === 'hero' ? 0.1 : 0.17),
              fromScale: word.role === 'hero' ? 0.98 : 1,
              transformFrames,
              opacityFrames,
              blurFrames,
              transformEase: 'stackEnter',
            }),
            element.motion,
          );
        return (
          <MotionSpan
            values={enter(frame)}
            blur={velocityBlur(enter, frame, word.fontSize, BLUR_GAIN.stack)}
          >
            {glyph}
          </MotionSpan>
        );
      }}
    />
  );
};
