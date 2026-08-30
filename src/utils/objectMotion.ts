/**
 * V6 — intent-based motion for scene objects.
 *
 * The user picks POP IN. They do not pick "scale 0.86 → 1.02 → 1.00 on
 * cubic-bezier(0.18, 1.42, 0.36, 1) while opacity runs a flatter curve and a
 * 6px blur burns off over the first third". That second sentence is what
 * actually happens, and keeping it on this side of the line is the entire
 * point of the engine.
 *
 * So a preset is a *recipe over channels* — opacity, x, y, scale, rotation,
 * blur — and the only things the UI exposes are the preset's name and, where it
 * genuinely changes the intent, a direction, a speed and a distance.
 *
 * Everything here is a pure function of the frame. No springs integrated over
 * time, no randomness, no reading the clock: the same frame always produces the
 * same transform, in the editor's `<Player>` and in the headless render alike.
 * That is not a style preference — a physics simulation that steps per rendered
 * frame silently desynchronises between a preview that drops frames and an
 * export that does not.
 *
 * Curves come from `easing.ts` rather than being invented here, so object
 * motion and type motion share the house feel.
 */

import { EASE, clamp01, type EaseName } from './easing';

export type MotionDirection = 'left' | 'right' | 'top' | 'bottom';
export type MotionSpeed = 'slow' | 'medium' | 'fast';
export type MotionDistance = 'small' | 'medium' | 'large';

export type EnterMotion =
  | 'none'
  | 'fade-in'
  | 'slide-in'
  | 'rise-in'
  | 'pop-in'
  | 'scale-in'
  | 'reveal'
  | 'float-in'
  | 'draw-in';

export type EmphasisMotion =
  | 'none'
  | 'pulse'
  | 'pop'
  | 'shake'
  | 'float'
  | 'glow'
  | 'bounce';

export type ExitMotion =
  | 'none'
  | 'fade-out'
  | 'slide-out'
  | 'scale-out'
  | 'shrink'
  | 'reveal-out';

/**
 * What a motion resolves to on a given frame. Everything is relative: `x`/`y`
 * are offsets in frame-width fractions, `scale` multiplies, `opacity`
 * multiplies the object's own.
 *
 * `reveal` is a wipe fraction rather than a transform — 0 shows nothing, 1
 * shows everything — because a reveal has to clip rather than move, and a
 * transform cannot express that.
 */
export type MotionState = {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  blur: number;
  reveal: number;
};

export const REST: MotionState = {
  opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, reveal: 1,
};

/** Entrance lengths in seconds. "Fast" is the workhorse. */
const SPEED_SECONDS: Record<MotionSpeed, number> = {
  slow: 1.05,
  medium: 0.72,
  fast: 0.45,
};

/**
 * Travel, as a fraction of the frame's width. Small is a nudge that reads as
 * weight rather than as movement; large crosses enough of the frame to feel
 * like an arrival without starting fully offscreen.
 */
const DISTANCE_FRACTION: Record<MotionDistance, number> = {
  small: 0.06,
  medium: 0.16,
  large: 0.34,
};

const axis = (direction: MotionDirection, amount: number): { x: number; y: number } => {
  switch (direction) {
    case 'left': return { x: -amount, y: 0 };
    case 'right': return { x: amount, y: 0 };
    case 'top': return { x: 0, y: -amount };
    case 'bottom': return { x: 0, y: amount };
  }
};

type EnterRecipe = {
  label: string;
  /** One line, shown in the editor. */
  description: string;
  /** Does a direction control make sense for this preset? */
  directional?: boolean;
  /**
   * `t` is eased progress 0..1 through the entrance. Returning a partial state
   * keeps each recipe to the channels it actually uses.
   */
  at: (t: number, distance: number, direction: MotionDirection) => Partial<MotionState>;
  /** Which curve drives `t`. Position and opacity deliberately differ. */
  ease?: EaseName;
  /** Opacity runs its own, flatter curve — see the note in easing.ts. */
  fadeEase?: EaseName;
};

/**
 * The entrance vocabulary.
 *
 * Each of these is a *combination*. FLOAT IN is not "translate up": it is
 * opacity on a flat curve, a rise on a settling curve, a slight scale-up, and a
 * blur that burns off early so the object reads before it has finished moving.
 * That is what makes it look designed rather than tweened.
 */
export const ENTER: Record<Exclude<EnterMotion, 'none'>, EnterRecipe> = {
  'fade-in': {
    label: 'Fade In',
    description: 'Opacity only. The quietest arrival there is.',
    at: (t) => ({ opacity: t }),
    ease: 'reveal',
  },
  'slide-in': {
    label: 'Slide In',
    description: 'Travels in from one edge and settles.',
    directional: true,
    at: (t, distance, direction) => {
      const { x, y } = axis(direction, distance * (1 - t));
      return { opacity: Math.min(1, t * 1.6), x, y };
    },
    ease: 'glide',
  },
  'rise-in': {
    label: 'Rise In',
    description: 'Lifts from below while it fades up.',
    at: (t, distance) => ({ opacity: t, y: distance * 0.5 * (1 - t) }),
    ease: 'settle',
  },
  'pop-in': {
    label: 'Pop In',
    description: 'Scales up fast with a small overshoot. The workhorse.',
    // The overshoot lives in the curve, not in the recipe — `punchEnter`
    // crosses 1 and comes back, so scale inherits it for free.
    at: (t) => ({ opacity: Math.min(1, t * 2), scale: 0.86 + 0.14 * t }),
    ease: 'punchEnter',
    fadeEase: 'reveal',
  },
  'scale-in': {
    label: 'Scale In',
    description: 'Grows from small to full. No overshoot.',
    at: (t) => ({ opacity: t, scale: 0.7 + 0.3 * t }),
    ease: 'settle',
  },
  reveal: {
    label: 'Reveal',
    description: 'Wipes into view from one edge without moving.',
    directional: true,
    at: (t) => ({ opacity: 1, reveal: t }),
    ease: 'inOut',
  },
  'float-in': {
    label: 'Float In',
    description: 'Drifts up into focus — opacity, a lift, a little scale, and blur.',
    at: (t, distance) => ({
      opacity: t,
      y: distance * 0.42 * (1 - t),
      scale: 0.96 + 0.04 * t,
      // Burns off in the first third so the object is legible early.
      blur: 10 * Math.max(0, 1 - t * 3),
    }),
    ease: 'settle',
    fadeEase: 'reveal',
  },
  'draw-in': {
    label: 'Draw In',
    description: 'Strokes itself on, as if being drawn. Best on icons and lines.',
    at: (t) => ({ opacity: 1, reveal: t, scale: 0.98 + 0.02 * t }),
    ease: 'focus',
  },
};

type EmphasisRecipe = {
  label: string;
  description: string;
  /** Seconds for one cycle. */
  period: number;
  /** `phase` is 0..1 within one cycle, and repeats. */
  at: (phase: number) => Partial<MotionState>;
};

/**
 * Emphasis runs on a loop for as long as the object is on screen, *after* it
 * has entered. These are deliberately small: emphasis that reads as animation
 * rather than as life is the fastest way to make a piece look cheap.
 */
export const EMPHASIS: Record<Exclude<EmphasisMotion, 'none'>, EmphasisRecipe> = {
  pulse: {
    label: 'Pulse',
    description: 'A slow breath in scale.',
    period: 1.6,
    at: (p) => ({ scale: 1 + 0.022 * Math.sin(p * Math.PI * 2) }),
  },
  pop: {
    label: 'Pop',
    description: 'One sharp scale kick, then still.',
    period: 1.2,
    // Only the first quarter of the cycle does anything.
    at: (p) => ({ scale: 1 + 0.07 * Math.max(0, Math.sin(p * Math.PI * 4)) * (p < 0.25 ? 1 : 0) }),
  },
  shake: {
    label: 'Shake',
    description: 'A short horizontal rattle. Use for errors.',
    period: 0.5,
    at: (p) => ({ x: 0.006 * Math.sin(p * Math.PI * 6) * (1 - p) }),
  },
  float: {
    label: 'Float',
    description: 'Drifts up and down. Good under a shadow.',
    period: 3.2,
    at: (p) => ({ y: -0.008 * Math.sin(p * Math.PI * 2) }),
  },
  glow: {
    label: 'Glow',
    description: 'The bloom swells and settles.',
    period: 2.0,
    // Carried on opacity; the renderer maps it onto the object's glow.
    at: (p) => ({ opacity: 1 - 0.06 * (0.5 - 0.5 * Math.cos(p * Math.PI * 2)) }),
  },
  bounce: {
    label: 'Bounce',
    description: 'A soft vertical bob with weight at the bottom.',
    period: 1.4,
    at: (p) => ({ y: -0.014 * Math.abs(Math.sin(p * Math.PI)) }),
  },
};

type ExitRecipe = {
  label: string;
  description: string;
  directional?: boolean;
  /** `t` is 0..1 through the exit; 0 is still fully present. */
  at: (t: number, distance: number, direction: MotionDirection) => Partial<MotionState>;
  ease?: EaseName;
};

/**
 * Exits accelerate away rather than decelerating, which is why they use
 * ease-in curves. An exit on an entrance curve looks like the object is being
 * pulled back rather than leaving — the same reasoning `easing.ts` gives for
 * the type exits.
 */
export const EXIT: Record<Exclude<ExitMotion, 'none'>, ExitRecipe> = {
  'fade-out': {
    label: 'Fade Out',
    description: 'Opacity only.',
    at: (t) => ({ opacity: 1 - t }),
    ease: 'exitFade',
  },
  'slide-out': {
    label: 'Slide Out',
    description: 'Leaves towards one edge.',
    directional: true,
    at: (t, distance, direction) => {
      const { x, y } = axis(direction, distance * t);
      return { opacity: 1 - t * 0.9, x, y };
    },
    ease: 'exitHard',
  },
  'scale-out': {
    label: 'Scale Out',
    description: 'Grows slightly as it goes, like it is passing the camera.',
    at: (t) => ({ opacity: 1 - t, scale: 1 + 0.16 * t }),
    ease: 'exit',
  },
  shrink: {
    label: 'Shrink',
    description: 'Collapses to nothing.',
    at: (t) => ({ opacity: 1 - t * 0.8, scale: 1 - 0.35 * t }),
    ease: 'exit',
  },
  'reveal-out': {
    label: 'Reveal Out',
    description: 'Wipes away from one edge without moving.',
    directional: true,
    at: (t) => ({ reveal: 1 - t }),
    ease: 'inOut',
  },
};

/** How long an exit runs, in seconds. Exits are quicker than entrances. */
const EXIT_SECONDS: Record<MotionSpeed, number> = {
  slow: 0.7,
  medium: 0.5,
  fast: 0.32,
};

export type MotionWindow = {
  /** Frame the object appears, relative to the scene. */
  from: number;
  /** Frames the object is on screen for. */
  frames: number;
};

const merge = (base: MotionState, patch: Partial<MotionState>): MotionState => ({
  opacity: base.opacity * (patch.opacity ?? 1),
  x: base.x + (patch.x ?? 0),
  y: base.y + (patch.y ?? 0),
  scale: base.scale * (patch.scale ?? 1),
  rotate: base.rotate + (patch.rotate ?? 0),
  blur: Math.max(base.blur, patch.blur ?? 0),
  reveal: Math.min(base.reveal, patch.reveal ?? 1),
});

/**
 * The whole motion of one object on one frame.
 *
 * Enter, emphasis and exit compose: an object can slide in, pulse while it
 * sits, and fade out, and the three are resolved independently and combined
 * rather than being three mutually exclusive choices. Emphasis is suppressed
 * during the entrance and the exit — a pulse fighting a pop reads as a glitch,
 * and no user would ever ask for it.
 */
export const resolveMotion = (
  motion: ObjectMotionInput | undefined,
  frame: number,
  fps: number,
  window: MotionWindow,
): MotionState => {
  if (!motion) return REST;

  const local = frame - window.from;
  if (local < 0 || local >= window.frames) {
    // Off its own timeline: fully transparent rather than at rest, so an
    // object with a `start` does not flash before its own entrance.
    return { ...REST, opacity: 0 };
  }

  const speed = motion.speed ?? 'medium';
  const distance = DISTANCE_FRACTION[motion.distance ?? 'medium'];
  const direction = motion.from ?? 'bottom';
  const delayFrames = Math.round((motion.delay ?? 0) * fps);

  let state: MotionState = { ...REST };

  /* ------------------------------------------------------------- entrance */
  const enterName = motion.enter && motion.enter !== 'none' ? motion.enter : null;
  const enterFrames = enterName
    ? Math.max(1, Math.round(SPEED_SECONDS[speed] * fps))
    : 0;
  let entering = false;

  if (enterName) {
    const recipe = ENTER[enterName];
    const since = local - delayFrames;
    if (since < 0) {
      // Waiting to enter. Not yet drawn.
      return { ...REST, opacity: 0 };
    }
    const raw = clamp01(since / enterFrames);
    entering = raw < 1;
    const t = EASE[recipe.ease ?? 'settle'](raw);
    const patch = recipe.at(t, distance, direction);
    // Opacity gets its own, flatter curve where the recipe asks for one.
    if (patch.opacity !== undefined && recipe.fadeEase) {
      patch.opacity = EASE[recipe.fadeEase](raw);
    }
    state = merge(state, patch);
  }

  /* ----------------------------------------------------------------- exit */
  const exitName = motion.exit && motion.exit !== 'none' ? motion.exit : null;
  const exitFrames = exitName
    ? Math.max(1, Math.round(EXIT_SECONDS[speed] * fps))
    : 0;
  const exitStart = window.frames - exitFrames;
  let exiting = false;

  if (exitName && local >= exitStart) {
    const recipe = EXIT[exitName];
    const raw = clamp01((local - exitStart) / exitFrames);
    exiting = true;
    const t = EASE[recipe.ease ?? 'exit'](raw);
    state = merge(state, recipe.at(t, distance, motion.exitTo ?? direction));
  }

  /* ------------------------------------------------------------- emphasis */
  if (motion.emphasis && motion.emphasis !== 'none' && !entering && !exiting) {
    const recipe = EMPHASIS[motion.emphasis];
    const period = Math.max(1, recipe.period * fps);
    // Phase is measured from the end of the entrance so the first cycle starts
    // where the object comes to rest, not where the scene does.
    const since = local - delayFrames - enterFrames;
    if (since >= 0) {
      state = merge(state, recipe.at((since % period) / period));
    }
  }

  return state;
};

/** The subset of `ObjectMotion` this module needs, without importing the type. */
export type ObjectMotionInput = {
  enter?: EnterMotion;
  from?: MotionDirection;
  speed?: MotionSpeed;
  distance?: MotionDistance;
  emphasis?: EmphasisMotion;
  exit?: ExitMotion;
  exitTo?: MotionDirection;
  delay?: number;
};

/** Editor vocabulary. One list per phase, in the order they should be offered. */
export const ENTER_NAMES = Object.keys(ENTER) as Exclude<EnterMotion, 'none'>[];
export const EMPHASIS_NAMES = Object.keys(EMPHASIS) as Exclude<EmphasisMotion, 'none'>[];
export const EXIT_NAMES = Object.keys(EXIT) as Exclude<ExitMotion, 'none'>[];
