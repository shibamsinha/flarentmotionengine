/**
 * V6 — resolving a scene's objects into something renderable.
 *
 * The planner's job is to turn authored intent into frames. Authors write
 * seconds ("start at 0.5, run for 1.2"), sequencing ("stagger the children by
 * 0.15") and interactions ("the cursor clicks the button at 2.1s"); the
 * renderer needs a window in frames and a state for the frame it is drawing.
 * Everything in between happens here, once, rather than being recomputed by
 * every component on every frame.
 *
 * This is a *separate* path from `plan.ts`. Text planning is untouched: it
 * still measures glyphs, solves compositions and resolves roles, and none of
 * that applies to a rounded rectangle. Sharing a planner between the two would
 * mean one of them carrying the other's concepts around.
 *
 * The tree is kept rather than flattened. A card's children are positioned in
 * *the card's* fractions, so nesting them in the output lets the renderer
 * compose transforms by nesting elements — which is also what makes "move the
 * card and its contents come with it" free rather than a feature.
 */

import type {
  ObjectState,
  SceneObject,
  StateTransition,
} from '../types/object';
import { isContainer } from '../types/object';
import type { MotionWindow, ObjectMotionInput } from './objectMotion';

/** A state the object is in, with when it got there. */
export type ResolvedState = {
  /** Frame, relative to the scene. */
  at: number;
  state: ObjectState;
  transition: StateTransition;
};

export type PlannedObject = {
  object: SceneObject;
  /** When this object is on screen, in frames relative to the scene. */
  window: MotionWindow;
  motion?: ObjectMotionInput;
  /** Painter's order among its siblings. */
  layer: number;
  children: PlannedObject[];
  /**
   * Every state this object passes through, in order, including the ones a
   * cursor click puts it into. Always starts with `default` at frame 0 so a
   * lookup can never fall off the front.
   */
  states: ResolvedState[];
};

export type ObjectPlan = {
  objects: PlannedObject[];
  /** Whether anything in the scene needs a pointer drawn. */
  hasCursor: boolean;
};

/** Seconds → frames, with the same rounding the timeline uses. */
const frames = (seconds: number, fps: number): number =>
  Math.max(0, Math.round(seconds * fps));

/**
 * How long a state transition takes. Deliberately a small fixed vocabulary
 * rather than a duration field — the brief asks for named transitions, and a
 * user choosing between "smooth" and "0.34s" is a user being asked the wrong
 * question.
 */
export const TRANSITION_SECONDS: Record<StateTransition, number> = {
  instant: 0,
  smooth: 0.28,
  spring: 0.42,
  morph: 0.5,
  fade: 0.34,
};

/**
 * Children's own timing, adjusted for the group's sequencing mode.
 *
 * `together` leaves them alone. `stagger` offsets each by a fixed step, which
 * is the one that makes a list of cards look designed. `after` chains them:
 * each child starts when the previous one's entrance has finished, which needs
 * the entrance length and is therefore computed here rather than in the UI.
 */
const sequenceOffset = (
  mode: 'together' | 'after' | 'stagger' | undefined,
  index: number,
  stagger: number,
  previousEnd: number,
): number => {
  if (!mode || mode === 'together') return 0;
  if (mode === 'stagger') return index * stagger;
  return previousEnd;
};

const planOne = (
  object: SceneObject,
  index: number,
  fps: number,
  /** The window of the parent, so a child cannot outlive its container. */
  parentWindow: MotionWindow,
  extraDelay: number,
): PlannedObject => {
  const startFrames = parentWindow.from + frames(object.start ?? 0, fps) + extraDelay;
  const available = Math.max(0, parentWindow.from + parentWindow.frames - startFrames);
  const own = object.duration !== undefined ? frames(object.duration, fps) : available;
  const window: MotionWindow = {
    from: startFrames,
    // Clamped to the parent: an object that outlived its card would keep
    // drawing after the card had gone, which is never what was meant.
    frames: Math.max(0, Math.min(own, available)),
  };

  const states: ResolvedState[] = [
    { at: window.from, state: 'default' as ObjectState, transition: 'instant' as StateTransition },
    ...(object.states ?? []).map((change) => ({
      at: window.from + frames(change.at, fps),
      state: change.to,
      transition: change.transition ?? 'smooth',
    })),
  ].sort((a, b) => a.at - b.at);

  let children: PlannedObject[] = [];
  if (isContainer(object) && object.children?.length) {
    const stagger = object.stagger ?? 0.12;
    let previousEnd = 0;
    children = object.children.map((child, i) => {
      const offset = sequenceOffset(object.sequence, i, frames(stagger, fps), previousEnd);
      const planned = planOne(child, i, fps, window, offset);
      // For `after`, the next child waits on this one's entrance, not its
      // whole life — otherwise a 3-second card would hold up its own button.
      const enterSeconds = child.motion?.enter && child.motion.enter !== 'none' ? 0.45 : 0;
      previousEnd = offset + frames(enterSeconds, fps);
      return planned;
    });
  }

  return {
    object,
    window,
    motion: object.motion,
    layer: object.layer ?? index,
    children,
    states,
  };
};

/**
 * Cursor actions are authored on the cursor but felt by the target, so they are
 * folded into the target's own state timeline here. That keeps the renderer
 * from having to know that cursors exist when it draws a button, and it means
 * "the button goes to success when clicked" is resolved once rather than being
 * re-derived per frame.
 */
const applyCursorActions = (
  planned: PlannedObject[],
  objects: SceneObject[],
  fps: number,
): void => {
  const byId = new Map<string, PlannedObject>();
  const index = (list: PlannedObject[]): void => {
    for (const item of list) {
      byId.set(item.object.id, item);
      index(item.children);
    }
  };
  index(planned);

  const walk = (list: SceneObject[]): void => {
    for (const object of list) {
      if (object.type === 'cursor') {
        for (const stop of object.stops ?? []) {
          if (!stop.targetId || !stop.targetState) continue;
          const target = byId.get(stop.targetId);
          if (!target) continue;
          target.states.push({
            at: frames(stop.at, fps),
            state: stop.targetState,
            // A click lands, it does not ease in. The *target's* response is
            // what carries the softness.
            transition: stop.action === 'click' ? 'spring' : 'smooth',
          });
          target.states.sort((a, b) => a.at - b.at);
        }
      }
      if (isContainer(object) && object.children?.length) walk(object.children);
    }
  };
  walk(objects);
};

export const planObjects = (
  objects: SceneObject[] | undefined,
  durationInFrames: number,
  fps: number,
): ObjectPlan => {
  if (!objects || objects.length === 0) {
    return { objects: [], hasCursor: false };
  }

  const scene: MotionWindow = { from: 0, frames: durationInFrames };
  const planned = objects.map((object, i) => planOne(object, i, fps, scene, 0));

  applyCursorActions(planned, objects, fps);

  // Painter's order. A stable sort on `layer` keeps authored order as the
  // tie-break, so two objects that never set a layer stay in the order written.
  planned.sort((a, b) => a.layer - b.layer);

  const anyCursor = (list: SceneObject[]): boolean =>
    list.some(
      (o) => o.type === 'cursor' || (isContainer(o) && anyCursor(o.children ?? [])),
    );

  return { objects: planned, hasCursor: anyCursor(objects) };
};

/**
 * Which state an object is in on a frame, and how far through the change it is.
 *
 * Returns the state being left as well as the one being entered so the renderer
 * can interpolate between two surfaces rather than snapping — that
 * interpolation is what "smooth" and "spring" actually mean.
 */
export const stateAtFrame = (
  states: ResolvedState[],
  frame: number,
  fps: number,
): { from: ObjectState; to: ObjectState; progress: number } => {
  let current = states[0] ?? { at: 0, state: 'default' as ObjectState, transition: 'instant' as StateTransition };
  let previous = current;
  for (const entry of states) {
    if (entry.at <= frame) {
      previous = current;
      current = entry;
    } else break;
  }
  if (current === previous) {
    return { from: current.state, to: current.state, progress: 1 };
  }
  const span = Math.max(1, Math.round(TRANSITION_SECONDS[current.transition] * fps));
  const progress = Math.min(1, Math.max(0, (frame - current.at) / span));
  return { from: previous.state, to: current.state, progress };
};
