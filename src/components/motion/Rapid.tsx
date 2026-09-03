/**
 * STYLE 05 — RAPID
 *
 * A staccato run of short beats. Deliberately motionless: the reference's fast
 * section is pixel-identical within each beat and cuts the background on every
 * one. At this tempo any easing turns to mush — the cut *is* the animation, and
 * the alternating field is what carries the energy.
 *
 * Type is set small (0.19 × frame width) so a single emphasised beat can drop
 * in at hero scale and land like a hammer.
 */

import React from 'react';
import type { BackgroundName } from '../../types/scene';
import type { RapidBeat, ScenePlan } from '../../utils/plan';
import { IDENTITY, MotionSpan, TypeBlock, type MotionProps } from './primitives';

const beatIn = (beats: RapidBeat[], frame: number) => {
  if (beats.length === 0) return undefined;
  const found = beats.find(
    (beat) => frame >= beat.from && frame < beat.from + beat.durationInFrames,
  );
  return found ?? beats[beats.length - 1];
};

export const beatAt = (plan: ScenePlan, frame: number) => beatIn(plan.beats, frame);

export const rapidBackground = (
  plan: ScenePlan,
  frame: number,
): BackgroundName => beatAt(plan, frame)?.background ?? plan.scene.background;

export const Rapid: React.FC<MotionProps> = ({ element, frame, color, visual }) => {
  const beat = beatIn(element.beats, frame);
  if (!beat) return null;

  return (
    <TypeBlock
      key={beat.id}
      block={beat.block}
      color={color}
      visual={visual}
      wordColors={element.wordColors}
      renderWord={(_word, _line, glyph) => (
        <MotionSpan values={IDENTITY}>{glyph}</MotionSpan>
      )}
    />
  );
};
