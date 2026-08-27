/**
 * Scene → frame arithmetic.
 *
 * Every duration in the engine flows through here. Nothing downstream is
 * allowed to assume a fixed length: a 5-second reel and a 60-second reel take
 * exactly the same code path.
 */

import type { CanvasFormat, Scene, VideoConfig } from '../types/scene';

/**
 * The frame formats the engine renders.
 *
 * A project picks one format, once — the same tier as the palette, not a
 * per-scene setting. `fps` is identical across formats on purpose: only the
 * frame changes shape, never the clock the reel is timed against, so a
 * duration in seconds means the same number of frames whichever format is
 * active.
 *
 * Landscape is not a crop of portrait — it is portrait's width and height
 * swapped, so every fractional rule in the engine (margins, bands, throws,
 * the type scale) lands on the new frame's own proportions rather than being
 * stretched or letterboxed into it.
 */
export const CANVAS_FORMATS: Record<CanvasFormat, VideoConfig> = {
  portrait: { width: 1080, height: 1920, fps: 30 },
  landscape: { width: 1920, height: 1080, fps: 30 },
};

export const FORMAT_LABEL: Record<CanvasFormat, string> = {
  portrait: 'Portrait · 9:16',
  landscape: 'Landscape · 16:9',
};

export const DEFAULT_FORMAT: CanvasFormat = 'portrait';

export const canvasFor = (format: CanvasFormat = DEFAULT_FORMAT): VideoConfig =>
  CANVAS_FORMATS[format] ?? CANVAS_FORMATS[DEFAULT_FORMAT];

/**
 * The portrait frame, kept as the engine's default `VideoConfig`.
 *
 * Every sizing/layout function below takes an explicit `canvas` parameter
 * defaulting to this — never a hidden global — so the same function is
 * correct whichever format is actually being planned. `CANVAS` itself is only
 * ever "the format nobody specified," which is portrait.
 */
export const CANVAS: VideoConfig = CANVAS_FORMATS.portrait;

/** Guard rails for the editor UI. */
export const MIN_SCENE_DURATION = 0.15;
export const MAX_SCENE_DURATION = 12;

export const secondsToFrames = (seconds: number, fps: number): number =>
  Math.max(1, Math.round(seconds * fps));

export const framesToSeconds = (frames: number, fps: number): number =>
  frames / fps;

export const sceneFrames = (scene: Scene, fps: number): number =>
  secondsToFrames(scene.duration, fps);

export type TimelineEntry = {
  scene: Scene;
  index: number;
  /** Absolute start frame in the composition. */
  from: number;
  durationInFrames: number;
  /** Absolute start time in seconds. */
  fromSeconds: number;
  durationInSeconds: number;
};

/**
 * Lay the scenes end to end. Frames are rounded per scene and then summed, so
 * the timeline never drifts away from what Remotion actually renders.
 */
export const buildTimeline = (
  scenes: Scene[],
  fps: number = CANVAS.fps,
): TimelineEntry[] => {
  let cursor = 0;
  return scenes.map((scene, index) => {
    const durationInFrames = sceneFrames(scene, fps);
    const entry: TimelineEntry = {
      scene,
      index,
      from: cursor,
      durationInFrames,
      fromSeconds: cursor / fps,
      durationInSeconds: durationInFrames / fps,
    };
    cursor += durationInFrames;
    return entry;
  });
};

/**
 * The composition length. A composition must be at least one frame long even
 * when the scene list is empty, otherwise Remotion refuses to mount.
 */
export const totalFrames = (scenes: Scene[], fps: number = CANVAS.fps): number =>
  Math.max(
    1,
    scenes.reduce((sum, scene) => sum + sceneFrames(scene, fps), 0),
  );

export const totalSeconds = (scenes: Scene[], fps: number = CANVAS.fps): number =>
  totalFrames(scenes, fps) / fps;

/** Which scene is on screen at an absolute frame. */
export const sceneAtFrame = (
  timeline: TimelineEntry[],
  frame: number,
): TimelineEntry | undefined =>
  timeline.find(
    (entry) => frame >= entry.from && frame < entry.from + entry.durationInFrames,
  );

/**
 * Split a frame budget into `count` beats that sum to *exactly* `frames`.
 *
 * Parts may come out zero when a scene is asked to hold more beats than it has
 * frames. That is deliberate: forcing a one-frame floor would make the beats
 * sum past the end of the scene, and every downstream offset would drift.
 * Callers drop the empty beats instead.
 */
export const distributeFrames = (frames: number, count: number): number[] => {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_unused, index) =>
    Math.round(((index + 1) * frames) / count) -
    Math.round((index * frames) / count),
  );
};

/** Cumulative offsets for a list of beat lengths. */
export const cumulative = (lengths: number[]): number[] => {
  let cursor = 0;
  return lengths.map((length) => {
    const from = cursor;
    cursor += length;
    return from;
  });
};

export const formatSeconds = (seconds: number): string =>
  `${seconds.toFixed(2).replace(/0$/, '')}s`;

export const formatTimecode = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const centis = Math.round((seconds - whole) * 100);
  return `${String(whole).padStart(2, '0')}:${String(centis).padStart(2, '0')}`;
};
