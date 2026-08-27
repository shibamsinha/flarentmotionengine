/**
 * The motion registry.
 *
 * Adding a sixth animation style is: write `NewAnimation.tsx`, add one entry
 * here. Nothing else in the engine — planner, composition, editor, timeline —
 * needs to know it exists.
 */

import type React from 'react';
import type {
  AnimationStyle,
  BackgroundName,
  PaletteName,
} from '../../types/scene';
import type { ScenePlan } from '../../utils/plan';
import { DEFAULT_PALETTE } from '../../utils/typography';
import type { MotionProps } from './primitives';
import { Massive } from './Massive';
import { Punch } from './Punch';
import { Slide } from './Slide';
import { Stack, stackBackground } from './Stack';
import { Rapid, rapidBackground } from './Rapid';

export type MotionStyleDefinition = {
  id: AnimationStyle;
  label: string;
  /** One line, shown in the editor. */
  description: string;
  Component: React.FC<MotionProps>;
  /**
   * Styles that cut the background themselves (RAPID always, STACK on demand)
   * override this. Everything else holds the scene's field.
   */
  backgroundAt?: (
    plan: ScenePlan,
    frame: number,
    palette: PaletteName,
  ) => BackgroundName;
  /** Which per-scene controls are meaningful for this style. */
  supports: {
    direction?: boolean;
    flipBackground?: boolean;
  };
};

export const MOTION_STYLES: Record<AnimationStyle, MotionStyleDefinition> = {
  massive: {
    id: 'massive',
    label: 'MASSIVE',
    description: 'Small to enormous in one move. Type runs past the frame edge.',
    Component: Massive,
    supports: {},
  },
  punch: {
    id: 'punch',
    label: 'PUNCH',
    description: 'Fast scale to 100% with a sub-1% overshoot. The workhorse.',
    Component: Punch,
    supports: {},
  },
  stack: {
    id: 'stack',
    label: 'STACK',
    description: 'Words land one by one into a pre-solved layout. Nothing shifts.',
    Component: Stack,
    backgroundAt: stackBackground,
    supports: { flipBackground: true },
  },
  slide: {
    id: 'slide',
    label: 'SLIDE',
    description: 'Travels in from an edge and settles on an exponential curve.',
    Component: Slide,
    backgroundAt: undefined,
    supports: { direction: true },
  },
  rapid: {
    id: 'rapid',
    label: 'RAPID',
    description: 'Staccato cuts, alternating field. One line or beat per item.',
    Component: Rapid,
    backgroundAt: rapidBackground,
    supports: { flipBackground: true },
  },
};

export const ANIMATION_STYLES: AnimationStyle[] = [
  'massive',
  'punch',
  'stack',
  'slide',
  'rapid',
];

export const styleDefinition = (style: AnimationStyle): MotionStyleDefinition =>
  MOTION_STYLES[style] ?? MOTION_STYLES.punch;

export const backgroundForFrame = (
  plan: ScenePlan,
  frame: number,
  palette: PaletteName = DEFAULT_PALETTE,
): BackgroundName => {
  const definition = styleDefinition(plan.style);
  return definition.backgroundAt
    ? definition.backgroundAt(plan, frame, palette)
    : plan.scene.background;
};
