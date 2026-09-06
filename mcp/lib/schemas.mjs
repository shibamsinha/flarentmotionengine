/**
 * Tool input vocabulary.
 *
 * Every enum here is read from the engine at startup rather than typed out, so
 * adding a composition preset or an entrance to `src/` makes it callable over
 * MCP with no edit in this directory. Restating the lists would create exactly
 * the drift §22 forbids — a second source of truth that is right until the day
 * it isn't.
 *
 * Enumerating values (rather than accepting free strings) is what lets a model
 * discover what Flarent can do from the tool schema alone: `list_tools` carries
 * the legal roles, sizes, positions and motions, so the model does not have to
 * guess and then be corrected. It also means an unsupported value fails at the
 * MCP boundary with a readable message instead of deep inside the importer.
 */

import { z } from 'zod';

/**
 * Zod enums over the engine's live vocabulary.
 *
 * `z.enum` wants a non-empty array; every list below comes from an engine
 * constant that is non-empty by construction, and the guard turns a future
 * empty one into a clear startup failure rather than a confusing schema.
 */
const enumOf = (values, name) => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Engine vocabulary "${name}" is empty — the bundle is wrong.`);
  }
  return z.enum(values);
};

export const buildSchemas = (engine) => {
  const role = enumOf(engine.TEXT_ROLES, 'TEXT_ROLES');
  const size = enumOf(engine.SIZE_PRESETS, 'SIZE_PRESETS');
  const position = enumOf(engine.POSITION_PRESETS, 'POSITION_PRESETS');
  const composition = enumOf(engine.COMPOSITION_PRESETS, 'COMPOSITION_PRESETS');
  const visualStyle = enumOf(engine.VISUAL_STYLE_NAMES, 'VISUAL_STYLE_NAMES');
  const enterMotion = enumOf(engine.ENTER_NAMES, 'ENTER_NAMES');
  const emphasisMotion = enumOf(engine.EMPHASIS_NAMES, 'EMPHASIS_NAMES');
  const exitMotion = enumOf(engine.EXIT_NAMES, 'EXIT_NAMES');

  /* V8 — read from the motion registry rather than typed out. Adding a style to
     `registry.ts` now makes it callable over MCP with no edit here, which is
     what stopped `none` from being a special case in two places. */
  const animationStyle = enumOf(engine.ANIMATION_STYLES, 'ANIMATION_STYLES');
  const fontRole = enumOf(engine.FONT_ROLES, 'FONT_ROLES');

  /* Fixed vocabularies — these live in the scene types, not in exported arrays,
     so they are the one place a literal list is correct. Kept beside the engine
     enums so a reader can see the whole vocabulary in one screen. */
  const background = z.enum(['green', 'cream', 'black']);
  const alignment = z.enum(['left', 'center', 'right']);
  const textCase = z.enum(['lower', 'upper', 'as-typed']);
  const direction = z.enum(['left', 'right', 'top', 'bottom']);
  const format = z.enum(['portrait', 'landscape']);
  const shapeKind = z.enum(['rectangle', 'rounded', 'circle', 'line']);
  const motionSpeed = z.enum(['slow', 'medium', 'fast']);
  const motionDistance = z.enum(['small', 'medium', 'large']);

  const projectId = z
    .string()
    .regex(/^prj_[0-9a-f]{12}$/, 'Project ids look like prj_a1b2c3d4e5f6.')
    .describe('Project id from create_project or list_projects.');

  const sceneId = z.string().min(1).describe('Scene id from inspect_project or create_scene.');

  /**
   * Element ids, and the wrinkle that catches every caller once.
   *
   * The Flarent document does not store text-element ids, so the importer
   * assigns positional ones (`0-1` is scene 0, element 1) each time a project is
   * loaded. They are therefore stable only while the scene's element order is —
   * adding, removing or reordering elements renumbers them. Object ids are
   * genuinely persistent by contrast, because objects *are* serialised with
   * their id.
   *
   * Saying so in the schema is the cheapest place to prevent a model caching an
   * id across an edit and then addressing the wrong line.
   */
  const elementId = z
    .string()
    .min(1)
    .describe(
      'Element or object id from inspect_scene. Text element ids are positional ' +
        '("0-1" = scene 0, element 1) and are renumbered when elements are added or ' +
        'removed, so re-read them after changing a scene. Object ids are stable.',
    );

  /**
   * V8 — a duration in frames.
   *
   * Offered beside `duration` (seconds) rather than instead of it. Editors and
   * cut lists think in frames and 7 is exact where 0.2333 is a rounding
   * accident; the document still stores seconds, so nothing about the format
   * changes. Frames win when both are given.
   */
  const durationInFrames = z
    .number()
    .int()
    .min(1)
    .max(Math.round(engine.MAX_SCENE_DURATION * 30))
    .describe(
      'Scene length in frames at 30fps. Exact, and takes precedence over `duration` ' +
        'if both are given.',
    );

  const enterFrames = z
    .number()
    .int()
    .min(1)
    .max(300)
    .describe(
      'How long the entrance takes, in frames. Overrides the style\'s own measured ' +
        'length; clamped to the scene if longer. Use it for fast cutting.',
    );

  /**
   * V8.2 — words entering one after another.
   *
   * A spacing plus a direction, not a per-word list: a list would be a keyframe
   * track wearing different clothes, and the engine resolves spacing the same
   * way it already does for object groups.
   */
  const staggerFrames = z
    .number()
    .int()
    .min(0)
    .max(60)
    .describe('Frames between one word entering and the next. 0 means together.');

  const staggerOrder = z
    .enum(['forward', 'reverse'])
    .describe('Which end reveals first. Forward is reading order.');

  const exitFrames = z
    .number()
    .int()
    .min(0)
    .max(120)
    .describe('How long the exit takes, in frames. 0 removes the overlap entirely.');

  const fitWidth = z
    .number()
    .min(0.05)
    .max(1)
    .describe(
      'Fit the type to this share of the frame width (e.g. 0.88) and never clip. ' +
        'Overrides the size preset.',
    );

  const duration = z
    .number()
    .min(engine.MIN_SCENE_DURATION)
    .max(engine.MAX_SCENE_DURATION)
    .describe(
      `Seconds, ${engine.MIN_SCENE_DURATION}–${engine.MAX_SCENE_DURATION}. ` +
        'Snapped to the 30fps frame grid on save.',
    );

  /** A CSS hex colour. Anything looser reaches the renderer and paints nothing. */
  const hexColor = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour such as #4ADE6A.');

  /**
   * Confirmation for destructive tools.
   *
   * A separate required-true flag rather than a "force" boolean that defaults to
   * on: the model has to say the word before anything is destroyed, which is
   * what §14 of the brief is protecting against.
   */
  const confirm = z
    .boolean()
    .optional()
    .describe('Must be true to proceed. Without it the call is refused and nothing is deleted.');

  /**
   * Idempotency key.
   *
   * Supplied by the client and replayed rather than re-executed, so a retry
   * after a dropped response cannot create a second project or start a second
   * render.
   */
  const idempotencyKey = z
    .string()
    .min(8)
    .max(128)
    .optional()
    .describe(
      'Optional client-generated key. Repeating a call with the same key returns the ' +
        'first result instead of performing the operation again.',
    );

  return {
    fontRole, durationInFrames, enterFrames, fitWidth,
    staggerFrames, staggerOrder, exitFrames,
    role, size, position, composition, visualStyle,
    enterMotion, emphasisMotion, exitMotion,
    animationStyle, background, alignment, textCase, direction, format,
    shapeKind, motionSpeed, motionDistance,
    projectId, sceneId, elementId, duration, hexColor, confirm, idempotencyKey,
  };
};
