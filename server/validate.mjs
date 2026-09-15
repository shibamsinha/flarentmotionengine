/**
 * Server-side validation of a render request.
 *
 * Everything here exists because the render endpoint used to accept
 * `Array.isArray(scenes)` and nothing else, which made two things true:
 *
 *  - **`{"duration": 100000}` was a three-million-frame render**, because
 *    `MAX_SCENE_DURATION` in `src/utils/timing.ts` is a UI constant and
 *    `buildTimeline` never clamps to it. Nothing between the socket and
 *    Remotion disagreed.
 *  - **An image `src` of `http://169.254.169.254/…` was fetched by the
 *    renderer's headless Chrome**, because `resolveImageSrc` passes any
 *    `http(s)://` through and the server never looked. That is a
 *    straightforward SSRF into the cloud metadata service.
 *
 * Two principles shape the code:
 *
 * **Reject, never clamp.** Silently trimming a hostile request teaches the
 * caller nothing and hides the attempt from the logs. A 400 naming the field is
 * both better security signal and better developer experience.
 *
 * **Walk the whole tree, don't enumerate fields.** `checkTree` visits every node
 * of the parsed body and validates *every* key named `src`, at any depth,
 * whatever the schema grows into next. Enumerating known paths — scene.image,
 * scene.objects[], overlay, audio — is how a nested object's `src` gets missed
 * two versions later. This deliberately does not encode the project schema:
 * the JSON format is unchanged and this file is not a second definition of it.
 */

const FPS = 30;

/* ------------------------------------------------------------------ PHASE 5 */

/**
 * Filenames that may appear after `uploads/`.
 *
 * Real uploads are content hashes (`<16 hex>.<ext>`), but the shipped templates
 * carry human placeholders like `uploads/your-image.jpg`, so the shape is
 * validated rather than the hash: one path segment, ordinary characters, no
 * traversal, no scheme. A name that does not exist on disk simply does not
 * render, which is the behaviour those placeholders already had.
 */
const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Static assets that ship with the checkout and are legitimately referenced by
 * scene data. `newObject('logo')` defaults to `/brand/logo-mark.png`, so
 * rejecting this would break every logo object ever created.
 */
const BRAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Is this asset source one the renderer is allowed to load?
 *
 * The allow-list is positive: a source is rejected unless it is recognisably a
 * managed upload or a shipped brand asset. Everything else — every scheme, every
 * host, every absolute path, every traversal, every encoded form of the above —
 * falls through to the rejection at the end. That ordering matters: a deny-list
 * of `http://`, `file://` and friends is a list you can always add one more
 * entry to, and `\\host\share`, `HTTP://`, `//evil.com` and `%2e%2e` are the
 * entries people forget.
 *
 * Returns null when acceptable, or a reason string.
 */
export const assetSrcProblem = (src) => {
  if (typeof src !== 'string') return 'must be a string';
  // An empty source is how "no image chosen yet" is represented — `newObject`
  // creates image objects with `src: ''`.
  if (src === '') return null;

  if (src.length > 256) return 'is too long';
  // Percent-encoding is rejected outright rather than decoded: a decoder here
  // would be a second, subtly different implementation of the one in the URL
  // parser downstream, and the difference between them is the vulnerability.
  if (/[%\\]/.test(src)) return 'must not contain percent-encoding or backslashes';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(src)) return 'must not contain control characters';
  if (src.includes('..')) return 'must not contain ".."';
  if (src.includes('//')) return 'must not contain "//"';
  // Any scheme at all, including the schemeless `//host` form handled above.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return 'must not be a URL';

  const trimmed = src.startsWith('/') ? src.slice(1) : src;
  const slash = trimmed.indexOf('/');
  if (slash === -1) return 'must be an uploaded asset (uploads/…)';

  const folder = trimmed.slice(0, slash);
  const name = trimmed.slice(slash + 1);

  if (folder === 'uploads') {
    return UPLOAD_NAME.test(name) ? null : 'is not a valid uploaded filename';
  }
  if (folder === 'brand') {
    return BRAND_NAME.test(name) ? null : 'is not a valid brand asset';
  }
  return 'must be an uploaded asset (uploads/…) or a bundled brand asset';
};

/* ------------------------------------------------------------------ PHASE 4 */

class Invalid extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

const MAX_DEPTH = 24;
const MAX_NODES = 200_000;

/**
 * One pass over the whole payload.
 *
 * Catches three classes of problem that no per-field check would:
 *
 *  - **Non-finite numbers.** JSON has no `NaN` or `Infinity` literal, so it is
 *    tempting to think `JSON.parse` cannot produce one — but `1e999` parses to
 *    `Infinity`, and an infinite duration reaches `Math.round` and poisons the
 *    whole timeline.
 *  - **Pathological structure.** Deep nesting and enormous node counts are cheap
 *    to send and expensive to render; both are capped independently of the byte
 *    limit, because 8MB of JSON can still be a million nodes.
 *  - **Asset sources anywhere.** Every `src` key, at every depth.
 */
const checkTree = (root) => {
  let nodes = 0;
  const walk = (value, depth, path) => {
    if (depth > MAX_DEPTH) throw new Invalid('is nested too deeply', path);
    if ((nodes += 1) > MAX_NODES) throw new Invalid('contains too many values', 'scenes');

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Invalid('must be a finite number', path);
      }
      return;
    }
    if (value === null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], depth + 1, `${path}[${i}]`);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (key === 'src') {
        const problem = assetSrcProblem(child);
        if (problem) throw new Invalid(problem, here);
        continue;
      }
      walk(child, depth + 1, here);
    }
  };
  walk(root, 0, '');
};

/** Mirrors `secondsToFrames` in `src/utils/timing.ts` exactly. */
const secondsToFrames = (seconds) => Math.max(1, Math.round(seconds * FPS));

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validate a render/still/contact-sheet payload.
 *
 * Returns `{ ok: true, frames, scenes }` or `{ ok: false, error, field }`. The
 * caller turns the latter into a 400 — this function never throws for invalid
 * input, only for a bug.
 */
export const validateRenderBody = (body, config) => {
  try {
    if (!isPlainObject(body)) throw new Invalid('must be a JSON object', 'body');

    const { scenes } = body;
    if (!Array.isArray(scenes)) throw new Invalid('must be an array', 'scenes');
    if (scenes.length === 0) throw new Invalid('must not be empty', 'scenes');
    if (scenes.length > config.maxScenes) {
      throw new Invalid(
        `has ${scenes.length} scenes; the limit is ${config.maxScenes}`,
        'scenes',
      );
    }

    // Structure and asset sources across the entire document, before any
    // arithmetic touches a value the walk might reject.
    checkTree(body);

    let frames = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!isPlainObject(scene)) throw new Invalid('must be an object', `scenes[${i}]`);

      const { duration } = scene;
      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        throw new Invalid('must be a finite number of seconds', `scenes[${i}].duration`);
      }
      if (duration <= 0) {
        throw new Invalid('must be greater than zero', `scenes[${i}].duration`);
      }
      if (duration > config.maxSceneSeconds) {
        throw new Invalid(
          `is ${duration}s; the limit is ${config.maxSceneSeconds}s`,
          `scenes[${i}].duration`,
        );
      }
      frames += secondsToFrames(duration);
    }

    if (frames > config.maxTotalFrames) {
      throw new Invalid(
        `would render ${frames} frames; the limit is ${config.maxTotalFrames}`,
        'scenes',
      );
    }

    if (body.format !== undefined && body.format !== 'portrait' && body.format !== 'landscape') {
      throw new Invalid('must be "portrait" or "landscape"', 'format');
    }
    if (body.palette !== undefined && body.palette !== 'forest' && body.palette !== 'ink') {
      throw new Invalid('must be "forest" or "ink"', 'palette');
    }

    /*
     * Audio. The render server already reshaped this defensively, but "ignore
     * what you cannot parse" is the wrong posture for a request that is asking
     * for minutes of CPU: a caller sending a broken selection should be told,
     * not quietly rendered without sound.
     */
    if (body.audio !== undefined && body.audio !== null) {
      const audio = body.audio;
      if (!isPlainObject(audio)) throw new Invalid('must be an object or null', 'audio');
      if (typeof audio.src !== 'string' || audio.src.trim() === '') {
        throw new Invalid('must name an uploaded audio file', 'audio.src');
      }
      const start = audio.sourceStart ?? 0;
      const end = audio.sourceEnd;
      if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
        throw new Invalid('must be a non-negative number', 'audio.sourceStart');
      }
      if (typeof end !== 'number' || !Number.isFinite(end)) {
        throw new Invalid('must be a finite number', 'audio.sourceEnd');
      }
      if (end <= start) {
        throw new Invalid('must be greater than audio.sourceStart', 'audio.sourceEnd');
      }
      for (const key of ['timelineStart', 'fadeIn', 'fadeOut']) {
        const value = audio[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new Invalid('must be a non-negative number', `audio.${key}`);
        }
      }
      if (audio.volume !== undefined) {
        const { volume } = audio;
        if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
          throw new Invalid('must be between 0 and 1', 'audio.volume');
        }
      }
    }

    if (body.overlay !== undefined && body.overlay !== null) {
      if (!isPlainObject(body.overlay)) {
        throw new Invalid('must be an object or null', 'overlay');
      }
      if (typeof body.overlay.src !== 'string' || body.overlay.src.trim() === '') {
        throw new Invalid('must name an uploaded image', 'overlay.src');
      }
    }

    return { ok: true, frames, scenes };
  } catch (problem) {
    if (problem instanceof Invalid) {
      return {
        ok: false,
        field: problem.field,
        error: `${problem.field || 'request'} ${problem.message}.`,
      };
    }
    throw problem;
  }
};

/** Frame list for a contact sheet: integers, in range, and not too many. */
export const validateSheetFrames = (frames, totalFrames, config) => {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { ok: false, error: 'frames must be a non-empty array.' };
  }
  if (frames.length > config.maxSheetFrames) {
    return { ok: false, error: `At most ${config.maxSheetFrames} frames in one sheet.` };
  }
  for (const frame of frames) {
    if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) {
      return { ok: false, error: 'frames must be non-negative finite numbers.' };
    }
  }
  return {
    ok: true,
    frames: frames.map((value) =>
      Math.min(Math.max(0, totalFrames - 1), Math.max(0, Math.round(value)))),
  };
};

export { FPS, secondsToFrames };
