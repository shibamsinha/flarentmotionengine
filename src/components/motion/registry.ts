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
import { DEFAULT_PALETTE, flipBackground } from '../../utils/typography';
import type { MotionProps } from './primitives';
import { Massive } from './Massive';
import { Punch } from './Punch';
import { Slide } from './Slide';
import { Stack, stackBackground } from './Stack';
import { Rapid, rapidBackground } from './Rapid';
import { Static } from './Static';

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
    label: 'Massive',
    description: 'Small to enormous in one move. Type runs past the frame edge.',
    Component: Massive,
    supports: {},
  },
  punch: {
    id: 'punch',
    label: 'Punch',
    description: 'Fast scale to 100% with a sub-1% overshoot. The workhorse.',
    Component: Punch,
    supports: {},
  },
  stack: {
    id: 'stack',
    label: 'Stack',
    description: 'Words land one by one into a pre-solved layout. Nothing shifts.',
    Component: Stack,
    backgroundAt: stackBackground,
    supports: { flipBackground: true },
  },
  slide: {
    id: 'slide',
    label: 'Slide',
    description: 'Travels in from an edge and settles on an exponential curve.',
    Component: Slide,
    backgroundAt: undefined,
    supports: { direction: true },
  },
  none: {
    id: 'none',
    label: 'None',
    description: 'No motion at all. The type is simply there — a held card, cut to.',
    Component: Static,
    supports: {},
  },
  rapid: {
    id: 'rapid',
    label: 'Rapid',
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
  // Last in the list because it is the exception rather than a default choice.
  'none',
];

export const styleDefinition = (style: AnimationStyle): MotionStyleDefinition =>
  MOTION_STYLES[style] ?? MOTION_STYLES.punch;

/**
 * Which field is on screen at a given frame.
 *
 * The single place a background is decided, which is why V8.2's alternation
 * lands here rather than in a style or a component: it has to compose with
 * whatever the style already does, and there is exactly one resolver to teach.
 *
 * Precedence: an explicit `backgroundMotion` wins over the style's own cutting.
 * A scene that says "alternate every 4 frames" has overridden RAPID's per-beat
 * flip, not asked for both at once.
 */
export const backgroundForFrame = (
  plan: ScenePlan,
  frame: number,
  palette: PaletteName = DEFAULT_PALETTE,
): BackgroundName => {
  const motion = plan.scene.backgroundMotion;
  if (motion && motion.mode === 'alternate') {
    const every = Math.max(1, Math.round(motion.everyFrames));
    /*
     * Integer division, so the field is *held* for `every` frames rather than
     * flipped on a curve — the whole point is a hard strobe. Deterministic from
     * the frame number alone, which is what keeps a render reproducible and a
     * scrub identical to a playthrough.
     */
    const flips = Math.floor(Math.max(0, frame) / every);
    const limit = motion.times === undefined
      ? flips
      : Math.min(flips, Math.max(0, Math.round(motion.times)));
    return limit % 2 === 0
      ? plan.scene.background
      : flipBackground(plan.scene.background, palette);
  }

  const definition = styleDefinition(plan.style);
  return definition.backgroundAt
    ? definition.backgroundAt(plan, frame, palette)
    : plan.scene.background;
};
