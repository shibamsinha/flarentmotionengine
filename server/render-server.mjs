/**
 * Flarent render server.
 *
 * Remotion renders in Node, not in the browser, so the editor posts its scene
 * list here and this process drives @remotion/renderer. Jobs are tracked so the
 * UI can show real progress rather than a spinner.
 *
 * Since the production-hardening pass this is also **the whole production
 * server**: it serves the built editor, the uploaded assets and the rendered
 * output, so a deployment is one Node process behind a reverse proxy and there
 * is no Vite in production. In development it behaves exactly as it always did
 * — Vite proxies `/api`, `/out` and `/uploads` here — because every new limit
 * defaults to off or to a ceiling far above anything real.
 *
 *   POST   /api/render          { scenes, … }        -> 202 { jobId }
 *   GET    /api/render/:id                           -> { status, progress, url, … }
 *   DELETE /api/render/:id                           -> cancel (queued or running)
 *   POST   /api/still           { scenes, frame }    -> one PNG  (queued)
 *   POST   /api/contact-sheet   { scenes, frames }   -> tiled PNG (queued)
 *   POST   /api/upload          raw bytes            -> { src }
 *   GET    /api/health                               -> liveness + capacity
 *   GET    /out/<file>                               -> a rendered file
 *   GET    /uploads/<file>                           -> an uploaded asset
 *   GET    /                                         -> the built editor
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { bundle } from '@remotion/bundler';
import { canvas, drawScaled, fillRect, readPng, writePng } from './png.mjs';
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';

import {
  config,
  ensureDirs,
  ensureRemotionPublicDir,
  migrateLegacyUploads,
  ROOT,
} from './config.mjs';
import { error as logError, log, uptimeSeconds, warn } from './log.mjs';
import { JobStore, outputExistsIn } from './jobs.mjs';
import { RenderQueue } from './queue.mjs';
import { validateRenderBody, validateSheetFrames } from './validate.mjs';
import { RateLimiter, clientKey } from './ratelimit.mjs';
import { capacity, sweep, usage } from './retention.mjs';
import { resolveWithin, sendFile, serveDist } from './static.mjs';
import {
  isAuthorised,
  isPublicPath,
  makeSessionValue,
  requestIsSecure,
  sessionCookie,
  signInPage,
  wantsHtml,
} from './auth.mjs';

const ENTRY = path.join(ROOT, 'src', 'remotion', 'index.ts');
const COMPOSITION_ID = 'FlarentVideo';

/** Formats the renderer's headless Chrome can decode reliably. */
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/gif', '.gif'],
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

/**
 * V7 — audio the renderer's Chrome and ffmpeg can both handle.
 *
 * Uploaded the same way images are, into the same directory: the render bundle's
 * `public/uploads` is a symlink to it, so the headless render reads exactly the
 * bytes the editor previewed. One asset path, one upload endpoint.
 */
const AUDIO_TYPES = new Map([
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/wave', '.wav'],
  ['audio/mp4', '.m4a'],
  ['audio/x-m4a', '.m4a'],
  ['audio/aac', '.aac'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.weba'],
  ['audio/flac', '.flac'],
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.weba', '.flac',
]);

/* ------------------------------------------------------------------- boot */

await ensureDirs();
const migrated = await migrateLegacyUploads((event, fields) => warn(event, fields));
if (migrated > 0) log('upload.migrated', { count: migrated, to: 'uploadDir' });
const REMOTION_PUBLIC_DIR = await ensureRemotionPublicDir();

const jobs = new JobStore(config.stateDir);
const recovered = await jobs.load(outputExistsIn(config.outDir));
const queue = new RenderQueue({ concurrency: config.maxConcurrentRenders, jobs });
const limiter = new RateLimiter(config.rateWindowMinutes);

/* ---------------------------------------------------------------- bundling */

let bundleCache = null; // { serveUrl, signature }

/**
 * Cheap change detector so edits to the engine invalidate the webpack bundle.
 *
 * **`public/` is deliberately not walked any more.** It used to be, because
 * Remotion copied it into the bundle and a new upload therefore had to force a
 * rebuild — which meant every single upload invalidated the bundle for everyone,
 * and the walk itself got slower with every file added.
 *
 * That is fixed at the source instead: `bundle()` is given `symlinkPublicDir`,
 * so the bundle's `public` is a *symlink* to `remotionPublicDir` and is read
 * live from disk at render time. An upload made a second ago is visible to a
 * bundle built an hour ago, with no rebuild and no signature involvement. So the
 * signature covers `src/` — the only thing whose change actually requires a
 * webpack run — and its cost no longer scales with user data.
 */
const sourceSignature = async () => {
  const stack = [path.join(ROOT, 'src')];
  let newest = 0;
  let count = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        const stat = await fsp.stat(full);
        newest = Math.max(newest, stat.mtimeMs);
        count += 1;
      }
    }
  }
  return `${count}:${Math.round(newest)}`;
};

const getBundle = async (onProgress) => {
  const signature = await sourceSignature();
  if (bundleCache && bundleCache.signature === signature) {
    onProgress(1);
    return bundleCache.serveUrl;
  }
  /*
   * Remotion ignores `symlinkPublicDir` on Windows and copies instead, and its
   * copy recreates each link inside `remotionPublicDir` as a plain directory
   * symlink — which an ordinary Windows account may not create (EPERM). So on
   * Windows it copies an empty folder, and the bundle's `public` is then made a
   * junction to the real one: the same live reads as the symlink elsewhere.
   */
  const windows = process.platform === 'win32';
  let publicDir = REMOTION_PUBLIC_DIR;
  if (windows) {
    publicDir = path.join(config.dataDir, 'remotion-public-empty');
    await fsp.mkdir(publicDir, { recursive: true });
  }
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    onProgress: (percent) => onProgress(percent / 100),
    webpackOverride: (webpackConfig) => webpackConfig,
    publicDir,
    /*
     * The whole of PHASE 15 in one option. Symlinking rather than copying is
     * what makes the bundle read assets live, which is what decouples uploads
     * from the bundle cache.
     */
    symlinkPublicDir: true,
  });
  if (windows) {
    const bundledPublic = path.join(serveUrl, 'public');
    await fsp.rm(bundledPublic, { recursive: true, force: true });
    await fsp.symlink(REMOTION_PUBLIC_DIR, bundledPublic, 'junction');
  }
  bundleCache = { serveUrl, signature };
  return serveUrl;
};

/* -------------------------------------------------------------------- jobs */

/**
 * Output filenames.
 *
 * They used to be built from the reel's own text — `discipline-beats-motivation-
 * 90f-mtlz2ekk.mp4` — which put the user's script in a URL and made the URL
 * semi-guessable from a timestamp. Names are now opaque and random.
 *
 * The friendly name is not lost: it is kept on the job as `downloadName` and
 * used for `Content-Disposition` when the file is fetched, so the browser still
 * saves something recognisable while the URL itself reveals nothing. Files
 * written before this change keep working — `/out/` serves any name it finds.
 */
const downloadSlug = (scenes) => {
  const words = scenes
    .flatMap((scene) => String(scene.text ?? '').split(/\s+/))
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return words || 'flarent';
};

const opaqueName = (prefix, suffix, extension) =>
  `${prefix}-${suffix}-${randomBytes(6).toString('hex')}${extension}`;

/**
 * Build the props the composition renders from.
 *
 * Every field is re-derived from the validated body rather than passed through,
 * so nothing reaches Remotion that has not been looked at. `format` is omitted
 * entirely rather than sent as 'portrait', so a caller that never heard of
 * formats keeps getting exactly what it always got.
 */
const buildInputProps = (body) => {
  const scenes = body.scenes;
  const palette = body?.palette === 'ink' ? 'ink' : 'forest';
  const format = body?.format === 'landscape' ? 'landscape' : 'portrait';

  const hexMap = (source) => {
    const out = {};
    if (source && typeof source === 'object') {
      for (const [name, value] of Object.entries(source)) {
        if (
          ['green', 'cream', 'black'].includes(name) &&
          typeof value === 'string' &&
          /^#[0-9a-f]{6}$/i.test(value)
        ) {
          out[name] = value;
        }
      }
    }
    return out;
  };

  const fields = hexMap(body?.fields);
  const ink = hexMap(body?.ink);
  const accent =
    typeof body?.accent === 'string' && /^#[0-9a-f]{6}$/i.test(body.accent)
      ? body.accent
      : null;

  const n = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  let overlay = null;
  if (body?.overlay && typeof body.overlay === 'object' &&
      typeof body.overlay.src === 'string' && body.overlay.src.trim() !== '') {
    const o = body.overlay;
    overlay = {
      src: o.src.trim(),
      x: n(o.x, 0.08),
      y: n(o.y, 0.05),
      width: Math.max(0.03, n(o.width, 0.26)),
      height: Math.max(0.03, n(o.height, 0.09)),
      fit: o.fit === 'cover' ? 'cover' : 'contain',
      opacity: Math.min(1, Math.max(0, n(o.opacity, 1))),
    };
  }

  let audio = null;
  if (body?.audio && typeof body.audio === 'object' &&
      typeof body.audio.src === 'string' && body.audio.src.trim() !== '') {
    const a = body.audio;
    const sourceStart = Math.max(0, n(a.sourceStart, 0));
    const sourceEnd = Math.max(sourceStart, n(a.sourceEnd, sourceStart));
    if (sourceEnd > sourceStart) {
      audio = {
        src: a.src.trim(),
        sourceStart,
        sourceEnd,
        timelineStart: Math.max(0, n(a.timelineStart, 0)),
        volume: Math.min(1, Math.max(0, n(a.volume, 1))),
        ...(a.muted === true ? { muted: true } : {}),
        ...(n(a.fadeIn, 0) > 0 ? { fadeIn: n(a.fadeIn, 0) } : {}),
        ...(n(a.fadeOut, 0) > 0 ? { fadeOut: n(a.fadeOut, 0) } : {}),
        ...(a.loop === true ? { loop: true } : {}),
      };
    }
  }

  return {
    scenes,
    palette,
    fields,
    ...(Object.keys(ink).length > 0 ? { ink } : {}),
    ...(accent ? { accent } : {}),
    ...(overlay ? { overlay } : {}),
    ...(audio ? { audio } : {}),
    ...(format === 'landscape' ? { format } : {}),
  };
};

const runRenderJob = async (jobId, inputProps, downloadName) => {
  const started = Date.now();
  const set = (patch) => jobs.update(jobId, patch);

  /*
   * Cancellation. Remotion's own signal is the only safe way to stop a render:
   * killing the process would orphan a headless Chrome and a half-written MP4.
   * The canceller is kept on the job so `DELETE /api/render/:id` can reach it.
   */
  const { cancelSignal, cancel } = makeCancelSignal();
  jobs.setCancel(jobId, cancel);
  set({ status: 'browser', progress: 0, startedAt: new Date().toISOString() });

  try {
    await ensureBrowser({
      onBrowserDownload: () => ({
        version: null,
        onProgress: ({ percent }) => set({ progress: percent }),
      }),
    });

    set({ status: 'bundling', progress: 0 });
    const serveUrl = await getBundle((progress) => set({ progress }));

    set({ status: 'rendering', progress: 0 });
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

    const filename = opaqueName('flarent', `${composition.durationInFrames}f`, '.mp4');
    const outputLocation = path.join(config.outDir, filename);
    set({ filename, frames: composition.durationInFrames });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps,
      // Social-ready H.264: high quality, universally decodable.
      crf: 17,
      x264Preset: 'slow',
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      audioCodec: null,
      chromiumOptions: { disableWebSecurity: false },
      cancelSignal,
      onProgress: ({ progress }) => set({ progress }),
    });

    const ms = Date.now() - started;
    set({
      status: 'done',
      progress: 1,
      filename,
      downloadName: `${downloadName}.mp4`,
      ms,
      frames: composition.durationInFrames,
      completedAt: new Date().toISOString(),
    });
    log('render.completed', {
      jobId, frames: composition.durationInFrames, ms, result: 'done',
    });
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : String(problem);
    // A cancelled render is not a failure — reporting it as one would have the
    // caller retry something the user deliberately stopped.
    const wasCancelled = jobs.get(jobId)?.status === 'cancelled' || /cancel/i.test(message);
    if (wasCancelled) {
      log('render.cancelled', { jobId, ms: Date.now() - started, result: 'cancelled' });
      set({
        status: 'cancelled',
        progress: 0,
        message: 'Cancelled.',
        completedAt: new Date().toISOString(),
      });
      return;
    }
    logError('render.failed', { jobId, ms: Date.now() - started, message, result: 'error' });
    set({
      status: 'error',
      progress: 0,
      message,
      completedAt: new Date().toISOString(),
    });
  }
};

/* ------------------------------------------------------------------ server */

const json = (res, code, body, extraHeaders = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
};

class TooLarge extends Error {
  constructor() {
    super('Payload too large');
    this.tooLarge = true;
  }
}

/**
 * Read a request body, refusing anything past `limit`.
 *
 * The over-limit path used to call `req.destroy()`, which tore the socket down
 * before the 413 could be written — so a caller that sent an oversized upload
 * got `ECONNRESET` rather than a message telling them the size cap. The stream
 * is paused instead, leaving the response writable, and the handler sends the
 * 413 with `Connection: close`. That is the standard shape for this: the
 * remaining body is deliberately never drained, because draining a hostile
 * multi-gigabyte upload just to be polite about it is the denial of service the
 * limit exists to prevent.
 */
const readRaw = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk) => {
      if (refused) return;
      size += chunk.length;
      if (size > limit) {
        refused = true;
        req.pause();
        reject(new TooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on('error', (problem) => {
      if (!refused) reject(problem);
    });
  });

/** Every 413 in this server, shaped the same way. */
const tooLargeResponse = (res, message) =>
  json(res, 413, { error: message }, { Connection: 'close' });

const readBody = async (req) =>
  (await readRaw(req, config.maxJsonBytes)).toString('utf8');

/**
 * Everything the still and contact-sheet paths share.
 *
 * Both run through the render queue rather than beside it: a preview is one
 * frame, but it still opens a headless Chrome, and the point of the queue is
 * that the machine never has more of those than it was configured for. There is
 * one queue, so a preview waits behind a running export when concurrency is 1 —
 * which is the intended trade, not an oversight.
 */
const withComposition = async (inputProps, work) => {
  await ensureBrowser();
  const serveUrl = await getBundle(() => {});
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
  return work(serveUrl, composition);
};

const runStill = async (inputProps, requestedFrame) =>
  withComposition(inputProps, async (serveUrl, composition) => {
    // Frame 0 of every reel is blank by design — entrance opacity starts at
    // zero — so an unspecified preview takes the midpoint, where there is
    // actually something to see.
    const frame = Number.isFinite(requestedFrame)
      ? Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(requestedFrame)))
      : Math.floor(composition.durationInFrames / 2);

    const filename = opaqueName('still', String(frame), '.png');
    const output = path.join(config.outDir, filename);

    await renderStill({
      composition, serveUrl, output, inputProps, frame,
      imageFormat: 'png',
      chromiumOptions: { disableWebSecurity: false },
    });

    const { size } = await fsp.stat(output);
    return {
      filename,
      url: `/out/${filename}`,
      frame,
      durationInFrames: composition.durationInFrames,
      width: composition.width,
      height: composition.height,
      bytes: size,
    };
  });

const runContactSheet = async (inputProps, wanted, requestedColumns) =>
  withComposition(inputProps, async (serveUrl, composition) => {
    const checked = validateSheetFrames(wanted, composition.durationInFrames, config);
    if (!checked.ok) throw new Error(checked.error);
    const frames = checked.frames;

    const columns = Math.max(
      1,
      Math.min(6, Math.round(Number(requestedColumns) || 0) || Math.ceil(Math.sqrt(frames.length))),
    );
    const rows = Math.ceil(frames.length / columns);

    // Cell size is derived from a target sheet width so the output is a
    // sensible size whatever the grid — a 6-wide sheet of full frames would
    // be 6480px across and useless to look at.
    const gap = 8;
    const targetWidth = 1400;
    const cellWidth = Math.max(80, Math.floor((targetWidth - gap * (columns + 1)) / columns));
    const cellHeight = Math.max(
      80,
      Math.round((cellWidth * composition.height) / composition.width),
    );

    const sheet = canvas(
      columns * cellWidth + gap * (columns + 1),
      rows * cellHeight + gap * (rows + 1),
      [18, 18, 18],
    );

    const temp = [];
    const cells = [];
    try {
      for (let i = 0; i < frames.length; i++) {
        const file = path.join(config.outDir, opaqueName('sheet', String(i), '.png'));
        await renderStill({
          composition, serveUrl, output: file, inputProps, frame: frames[i],
          imageFormat: 'png',
          chromiumOptions: { disableWebSecurity: false },
        });
        temp.push(file);

        const column = i % columns;
        const row = Math.floor(i / columns);
        const x = gap + column * (cellWidth + gap);
        const y = gap + row * (cellHeight + gap);

        drawScaled(sheet, readPng(file), x, y, cellWidth, cellHeight);
        // A hairline under each cell separates frames that share a field
        // colour, which is otherwise the one case where a grid reads as one
        // continuous image.
        fillRect(sheet, x, y + cellHeight - 1, cellWidth, 1, [60, 60, 60]);

        cells.push({ index: i, frame: frames[i], column, row, x, y, width: cellWidth, height: cellHeight });
      }

      const filename = opaqueName('contact', String(frames.length), '.png');
      const output = path.join(config.outDir, filename);
      writePng(output, sheet);
      const { size } = await fsp.stat(output);

      return {
        filename,
        url: `/out/${filename}`,
        width: sheet.width,
        height: sheet.height,
        columns,
        rows,
        bytes: size,
        cells,
        durationInFrames: composition.durationInFrames,
      };
    } finally {
      // The individual frames were scaffolding; only the sheet is the result.
      for (const file of temp) await fsp.rm(file, { force: true });
    }
  });

/* ------------------------------------------------------------------ routes */

const handleRenderish = async (req, res, url, kind) => {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (problem) {
    if (problem?.tooLarge) {
      log('render.rejected', { kind, reason: 'body-size' });
      return tooLargeResponse(
        res,
        `Request is larger than ${Math.round(config.maxJsonBytes / 1024 / 1024)}MB`,
      );
    }
    return json(res, 400, { error: 'Request body is not valid JSON.' });
  }

  /* PHASE 4 — every limit enforced here, server-side, before anything costs. */
  const checked = validateRenderBody(body, config);
  if (!checked.ok) {
    log('render.rejected', { kind, reason: 'validation', field: checked.field });
    return json(res, 400, { error: checked.error, field: checked.field });
  }

  /* PHASE 10 — refuse work the disk cannot hold. */
  const room = await capacity(config);
  if (!room.ok) {
    warn('render.rejected', { kind, reason: 'disk' });
    return json(res, 507, { error: room.reason });
  }

  if (!queue.accepting) {
    return json(res, 503, { error: 'The render server is shutting down.' });
  }

  const inputProps = buildInputProps(body);

  if (kind === 'render') {
    const job = jobs.create({
      kind: 'render',
      frames: checked.frames,
      downloadName: downloadSlug(checked.scenes),
    });
    log('render.start', {
      jobId: job.jobId, kind, frames: checked.frames, scenes: checked.scenes.length,
      queued: queue.stats().queued,
    });
    // Fire and forget — the client polls for progress. A rejection here is
    // already recorded on the job, so the promise is deliberately not awaited.
    queue
      .submit(job.jobId, () => runRenderJob(job.jobId, inputProps, job.downloadName))
      .catch(() => {});
    return json(res, 202, { jobId: job.jobId });
  }

  /*
   * Stills and contact sheets.
   *
   * These stay synchronous by default because MCP's `render_preview` and
   * `render_contact_sheet` call them that way and expect the result in the
   * response — converting them outright would break tools that work today. The
   * safety problem was never the synchrony, it was the *unbounded concurrency*,
   * and running them through the same queue fixes that without changing the
   * contract. `async: true` opts into the job model for callers that want it.
   */
  const job = jobs.create({ kind, frames: checked.frames });
  const wantsAsync = body?.async === true;
  log('render.start', { jobId: job.jobId, kind, frames: checked.frames });

  const task = async () => {
    jobs.update(job.jobId, {
      status: 'rendering',
      startedAt: new Date().toISOString(),
    });
    const started = Date.now();
    try {
      const result = kind === 'still'
        ? await runStill(inputProps, Number(body?.frame))
        : await runContactSheet(inputProps, body?.frames, body?.columns);
      jobs.update(job.jobId, {
        status: 'done',
        progress: 1,
        filename: result.filename,
        ms: Date.now() - started,
        completedAt: new Date().toISOString(),
        result,
      });
      log('render.completed', { jobId: job.jobId, kind, ms: Date.now() - started, result: 'done' });
      return result;
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : String(problem);
      jobs.update(job.jobId, {
        status: 'error',
        message,
        completedAt: new Date().toISOString(),
      });
      logError('render.failed', { jobId: job.jobId, kind, message, result: 'error' });
      throw problem;
    }
  };

  if (wantsAsync) {
    queue.submit(job.jobId, task).catch(() => {});
    return json(res, 202, { jobId: job.jobId });
  }

  try {
    const result = await queue.submit(job.jobId, task);
    if (result?.cancelled) {
      return json(res, 409, { error: 'The job was cancelled.', jobId: job.jobId });
    }
    return json(res, 200, { jobId: job.jobId, ...result });
  } catch (problem) {
    return json(res, 500, {
      error: problem instanceof Error ? problem.message : String(problem),
      jobId: job.jobId,
    });
  }
};

const handleUpload = async (req, res, url) => {
  try {
    const contentType = String(req.headers['content-type'] ?? '').split(';')[0];

    /*
     * The client's filename is used for exactly one thing: reading an extension
     * when the content-type is unhelpful. It never reaches the filesystem —
     * the stored name is a hash of the bytes.
     */
    const declared = String(url.searchParams.get('name') ?? 'image');
    const declaredExt = path.extname(declared).toLowerCase();

    /*
     * `?kind=audio` selects the audio vocabulary. The caller says what it is
     * rather than the server guessing, because several containers (webm, mp4)
     * are legal for both and sniffing would get it wrong exactly where it
     * matters.
     */
    const kind = url.searchParams.get('kind') === 'audio' ? 'audio' : 'image';
    const table = kind === 'audio' ? AUDIO_TYPES : IMAGE_TYPES;
    const known = kind === 'audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
    const limit = kind === 'audio' ? config.maxAudioBytes : config.maxUploadBytes;

    const extension = table.get(contentType) ?? (known.has(declaredExt) ? declaredExt : null);
    if (!extension) {
      log('upload.rejected', { kind, reason: 'type' });
      return json(res, 415, {
        error:
          kind === 'audio'
            ? 'Unsupported audio type. Use MP3, WAV, M4A, AAC, OGG, WebM or FLAC.'
            : 'Unsupported image type. Use JPEG, PNG, WebP, AVIF or GIF.',
      });
    }

    const room = await capacity(config);
    if (!room.ok) {
      warn('upload.rejected', { kind, reason: 'disk' });
      return json(res, 507, { error: room.reason });
    }

    const buffer = await readRaw(req, limit);
    if (buffer.length === 0) {
      log('upload.rejected', { kind, reason: 'empty' });
      return json(res, 400, { error: 'Empty upload' });
    }

    // Content-addressed: re-uploading the same picture reuses one file.
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const filename = `${hash}${extension === '.jpeg' ? '.jpg' : extension}`;
    const target = path.join(config.uploadDir, filename);
    if (!fs.existsSync(target)) await fsp.writeFile(target, buffer);

    log('upload.stored', { kind, bytes: buffer.length, name: filename });
    return json(res, 201, { src: `uploads/${filename}`, bytes: buffer.length });
  } catch (problem) {
    const isAudio = url.searchParams.get('kind') === 'audio';
    if (problem?.tooLarge) {
      const cap = isAudio ? config.maxAudioBytes : config.maxUploadBytes;
      log('upload.rejected', { kind: isAudio ? 'audio' : 'image', reason: 'size' });
      return tooLargeResponse(
        res,
        `${isAudio ? 'Audio' : 'Image'} is larger than ${
          Math.round((cap / 1024 / 1024) * 100) / 100}MB`,
      );
    }
    return json(res, 400, {
      error: problem instanceof Error ? problem.message : String(problem),
    });
  }
};

const handleHealth = async (res) => {
  const stats = await usage(config);
  const q = queue.stats();
  const memory = process.memoryUsage();
  const gb = (bytes) => (bytes === null ? null : Number((bytes / 1024 ** 3).toFixed(3)));

  /* Capacity and liveness, never content and never a path. */
  return json(res, 200, {
    ok: true,
    uptimeSeconds: uptimeSeconds(),
    renders: {
      active: q.running,
      queued: q.queued,
      concurrency: q.concurrency,
      accepting: q.accepting,
    },
    bundle: { built: Boolean(bundleCache) },
    disk: {
      outputGb: gb(stats.outBytes),
      uploadsGb: gb(stats.uploadBytes),
      totalGb: gb(stats.totalBytes),
      freeGb: gb(stats.freeBytes),
      quotaGb: config.maxDiskGb || null,
      outputFiles: stats.outFiles,
      uploadFiles: stats.uploadFiles,
    },
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    },
    retentionHours: config.retentionHours || null,
    authRequired: Boolean(config.accessToken),
  });
};

/* ------------------------------------------------------------------ router */

/**
 * Reject a traversal attempt on the raw request line, before anything routes.
 *
 * `new URL()` resolves `..` away, so `/out/../../../etc/passwd` arrives at the
 * router as `/etc/passwd` — harmless here, since it then matches no file root
 * and falls through to the SPA shell, but it means the request is answered `200`
 * instead of being refused, and a normaliser quietly rewriting hostile input is
 * not something to build on. The raw path is checked first so the answer is the
 * one the caller deserves and does not depend on a parser's good manners.
 */
const traversalInRawPath = (rawUrl) => {
  const raw = String(rawUrl ?? '/').split('?')[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return true; // malformed encoding is never legitimate here
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return true;
  return decoded.split('/').some((segment) => segment === '..');
};

const server = http.createServer(async (req, res) => {
  if (traversalInRawPath(req.url)) {
    return json(res, 400, { error: 'Bad path' });
  }

  const url = new URL(req.url ?? '/', 'http://flarent.invalid');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  try {
    /* ------------------------------------------------- PHASE 11 — the gate */

    if (config.accessToken && pathname === '/__auth') {
      if (method === 'GET') {
        const page = signInPage();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(page),
        });
        return res.end(page);
      }
      if (method === 'POST') {
        // Rate-limited hard: this is the only brute-forceable surface.
        const gate = limiter.check(`auth:${clientKey(req, config.trustProxy)}`, 10);
        if (!gate.allowed) {
          res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(signInPage('Too many attempts. Wait a few minutes.'));
        }
        const form = new URLSearchParams(await readRaw(req, 4096).then((b) => b.toString('utf8')));
        const supplied = form.get('token') ?? '';
        // Never logged, never echoed, compared in constant time inside auth.mjs.
        if (!isAuthorised({ headers: { authorization: `Bearer ${supplied}` } }, config)) {
          warn('auth.failed', {});
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(signInPage('That token was not accepted.'));
        }
        const value = makeSessionValue(config.accessToken, config.sessionHours * 3600_000);
        res.writeHead(303, {
          Location: '/',
          'Set-Cookie': sessionCookie(value, {
            secure: requestIsSecure(req),
            maxAgeSeconds: config.sessionHours * 3600,
          }),
        });
        return res.end();
      }
    }

    if (!isPublicPath(pathname) && !isAuthorised(req, config)) {
      if (wantsHtml(req) && method === 'GET') {
        res.writeHead(302, { Location: '/__auth', 'Cache-Control': 'no-store' });
        return res.end();
      }
      return json(res, 401, { error: 'Authentication required.' });
    }

    /* ----------------------------------------------------------- PHASE 14 */

    if (pathname === '/api/health') return handleHealth(res);

    /* ------------------------------------------- PHASE 12 — rate limiting */

    const expensive =
      method === 'POST' &&
      ['/api/render', '/api/still', '/api/contact-sheet', '/api/upload'].includes(pathname);
    if (expensive) {
      const isUpload = pathname === '/api/upload';
      const gate = limiter.check(
        `${isUpload ? 'up' : 'rn'}:${clientKey(req, config.trustProxy)}`,
        isUpload ? config.rateLimitUploads : config.rateLimitRenders,
      );
      if (!gate.allowed) {
        const retryAfter = Math.ceil(gate.resetMs / 1000);
        warn(isUpload ? 'upload.rejected' : 'render.rejected', {
          reason: 'rate-limit', path: pathname,
        });
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'Cache-Control': 'no-store',
        });
        return res.end(JSON.stringify({
          error: 'Too many requests. Slow down and try again shortly.',
          retryAfterSeconds: retryAfter,
        }));
      }
    }

    /* -------------------------------------------------------------- /api  */

    if (method === 'POST' && pathname === '/api/render') {
      return handleRenderish(req, res, url, 'render');
    }
    if (method === 'POST' && pathname === '/api/still') {
      return handleRenderish(req, res, url, 'still');
    }
    if (method === 'POST' && pathname === '/api/contact-sheet') {
      return handleRenderish(req, res, url, 'contact-sheet');
    }
    if (method === 'POST' && pathname === '/api/upload') {
      return handleUpload(req, res, url);
    }

    if (pathname.startsWith('/api/render/') && method === 'DELETE') {
      const jobId = pathname.slice('/api/render/'.length);
      const job = jobs.get(jobId);
      if (!job) return json(res, 404, { error: 'Unknown job' });
      const outcome = queue.cancel(jobId);
      if (!outcome) {
        return json(res, 409, { error: `Job is already ${job.status}.`, status: job.status });
      }
      log('render.cancelled', { jobId, result: outcome });
      return json(res, 200, { jobId, status: 'cancelled', wasQueued: outcome === 'queued' });
    }

    if (pathname.startsWith('/api/render/') && method === 'GET') {
      const jobId = pathname.slice('/api/render/'.length);
      const view = jobs.view(jobId);
      if (!view) return json(res, 404, { error: 'Unknown job' });
      return json(res, 200, view);
    }

    /* ------------------------------------------------- PHASE 8 — outputs  */

    if (pathname.startsWith('/out/') && (method === 'GET' || method === 'HEAD')) {
      const file = resolveWithin(config.outDir, pathname.slice('/out/'.length));
      if (!file) return json(res, 400, { error: 'Bad path' });

      /*
       * The friendly name lives on the job, not in the URL. A video is sent as
       * an attachment (which is what Export MP4 has always produced); a PNG is
       * sent inline so a contact sheet can simply be opened.
       */
      const name = path.basename(file);
      const record = jobs.findByFilename(name);
      const served = await sendFile(req, res, file, {
        download: path.extname(name).toLowerCase() === '.mp4',
        downloadName: record?.downloadName,
        cacheControl: 'private, max-age=300',
      });
      if (!served) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      return undefined;
    }

    /* ------------------------------------------------- PHASE 2 — uploads  */

    if (pathname.startsWith('/uploads/') && (method === 'GET' || method === 'HEAD')) {
      const file = resolveWithin(config.uploadDir, pathname.slice('/uploads/'.length));
      if (!file || !(await sendFile(req, res, file, {
        cacheControl: 'private, max-age=31536000, immutable',
      }))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      return undefined;
    }

    /* ------------------------------------------- PHASE 3 — the built app  */

    if ((method === 'GET' || method === 'HEAD') && !pathname.startsWith('/api/')) {
      if (await serveDist(req, res, pathname, config.distDir)) return undefined;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Flarent render server');
  } catch (problem) {
    logError('request.failed', {
      path: pathname,
      message: problem instanceof Error ? problem.message : String(problem),
    });
    if (!res.headersSent) return json(res, 500, { error: 'Internal error' });
    return res.destroy();
  }
});

server.on('error', (problem) => {
  if (problem.code === 'EADDRINUSE') {
    logError('server.port-in-use', { port: config.port });
    console.error(
      `\n[flarent] Port ${config.port} is already in use, so the render server cannot start.` +
        '\n[flarent] Usually that means a previous `npm run dev` is still running.' +
        `\n[flarent] Free it with:   lsof -ti:${config.port} | xargs kill` +
        '\n[flarent] Or pick another port:   FLARENT_RENDER_PORT=5184 npm run dev\n',
    );
    process.exit(1);
  }
  throw problem;
});

/* --------------------------------------------------- retention + shutdown */

const sweepNow = async () => {
  const removed = await sweep(config, jobs.activeFilenames());
  if (removed.outputs > 0 || removed.temp > 0) {
    log('retention.swept', {
      outputs: removed.outputs, temp: removed.temp,
      mb: Math.round(removed.bytes / 1024 / 1024),
    });
  }
};

const sweepTimer = setInterval(() => void sweepNow(), config.sweepMinutes * 60_000);
sweepTimer.unref();

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  const dropped = queue.stop();
  log('server.shutdown', { signal, droppedFromQueue: dropped });
  server.close();
  clearInterval(sweepTimer);
  // Running renders are left to finish or be killed with the process; the job
  // table records whatever state they reached, and anything still live comes
  // back as `interrupted` on the next boot rather than as a lie.
  await jobs.flush();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(config.port, config.host, () => {
  log('server.started', {
    port: config.port,
    host: config.host,
    concurrency: config.maxConcurrentRenders,
    maxScenes: config.maxScenes,
    maxTotalFrames: config.maxTotalFrames,
    retentionHours: config.retentionHours || 'off',
    diskQuotaGb: config.maxDiskGb || 'off',
    auth: config.accessToken ? 'token' : 'open',
    trustProxy: config.trustProxy,
    dist: fs.existsSync(config.distDir) ? 'serving' : 'absent',
    restoredJobs: recovered.restored,
    interruptedJobs: recovered.interrupted,
  });
  void sweepNow();
});

export { server, jobs, queue, config };
