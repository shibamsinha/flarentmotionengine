/**
 * Production configuration.
 *
 * Every operational knob the render server has, read once from the environment
 * and frozen. Two rules govern the defaults:
 *
 *  1. **An unset environment must behave exactly like development did.** Nothing
 *     here may make `npm run dev` do something new. That is why retention and
 *     the disk quota default to *disabled* rather than to the production
 *     examples — a default that deleted a developer's rendered work would be a
 *     far worse bug than the one it was added to fix.
 *  2. **No production path is hard-coded.** `/data/out` appears in the docs and
 *     nowhere in the code.
 *
 * The one default that deliberately *does* differ from old behaviour is
 * `UPLOAD_DIR`. Uploads used to live in `public/uploads`, which put user data
 * inside the Vite build input and inside the Remotion bundle signature. Both
 * were bugs; see `remotionPublicDir()` below and PHASE 15.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

/** Everything the server owns at runtime that is not source code. */
const DATA_DIR = process.env.FLARENT_DATA_DIR
  ? path.resolve(process.env.FLARENT_DATA_DIR)
  : path.join(ROOT, '.flarent-data');

const dir = (value, fallback) => (value ? path.resolve(value) : fallback);

/**
 * A non-negative number from the environment, or the fallback.
 *
 * Anything unparseable is the fallback rather than an error: a typo in a unit
 * file should not stop the server from booting, and the resolved values are
 * logged at startup so a wrong one is visible.
 */
const num = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const config = Object.freeze({
  root: ROOT,
  dataDir: DATA_DIR,

  /* ------------------------------------------------------------- PHASE 1 */

  /** Rendered MP4s, stills and contact sheets. */
  outDir: dir(process.env.FLARENT_OUT_DIR, path.join(ROOT, 'out')),

  /**
   * Uploaded images and audio.
   *
   * Outside `public/` on purpose (PHASE 2). `public/` is Vite's build input and
   * Remotion's bundle-signature input; runtime user data belongs in neither.
   */
  uploadDir: dir(process.env.FLARENT_UPLOAD_DIR, path.join(DATA_DIR, 'uploads')),

  /** Where the job table is persisted (PHASE 7). */
  stateDir: path.join(DATA_DIR, 'state'),

  /**
   * The public directory handed to Remotion's bundler.
   *
   * Assembled at boot as a directory of symlinks — see `ensureRemotionPublicDir`.
   */
  remotionPublicDir: path.join(DATA_DIR, 'remotion-public'),

  /** The Vite production build. Served when it exists (PHASE 3). */
  distDir: dir(process.env.FLARENT_DIST_DIR, path.join(ROOT, 'dist')),

  /** App static assets that ship with the checkout: fonts, brand marks, icons. */
  publicDir: path.join(ROOT, 'public'),

  host: process.env.FLARENT_HOST ?? '0.0.0.0',
  port: Number(process.env.FLARENT_RENDER_PORT ?? 5174),

  /* ------------------------------------------------- PHASE 4 / 6 — limits */

  /** Renders allowed to run at once. Everything beyond this queues (PHASE 6). */
  maxConcurrentRenders: Math.max(1, Math.round(num(process.env.FLARENT_MAX_CONCURRENT_RENDERS, 1))),

  /**
   * The cost ceiling on a single render, in frames.
   *
   * 3600 is two minutes at 30fps. The longest reel in this repository is 718
   * frames, so the default is generous by a factor of five while still making
   * `{"duration": 100000}` — three million frames — a 400 instead of an outage.
   */
  maxTotalFrames: Math.max(1, Math.round(num(process.env.FLARENT_MAX_TOTAL_FRAMES, 3600))),

  /** The longest real project here has 31 scenes. */
  maxScenes: Math.max(1, Math.round(num(process.env.FLARENT_MAX_SCENES, 100))),

  /**
   * The engine's own per-scene ceiling, enforced server-side.
   *
   * `MAX_SCENE_DURATION` in `src/utils/timing.ts` is a *UI* constant —
   * `buildTimeline` never clamps to it — so this is the first place it is
   * actually enforced against a request.
   */
  maxSceneSeconds: num(process.env.FLARENT_MAX_SCENE_SECONDS, 12),

  /** JSON request bodies. Unchanged from the original 8MB. */
  maxJsonBytes: Math.round(num(process.env.FLARENT_MAX_JSON_MB, 8) * 1024 * 1024),

  maxUploadBytes: Math.round(num(process.env.FLARENT_MAX_UPLOAD_MB, 24) * 1024 * 1024),
  /** Audio gets a larger ceiling: an uncompressed WAV runs ~10MB a minute. */
  maxAudioBytes: Math.round(num(process.env.FLARENT_MAX_AUDIO_MB, 64) * 1024 * 1024),

  /** At most this many frames in one contact sheet. Unchanged. */
  maxSheetFrames: 36,

  /* ------------------------------------------------ PHASE 10 — retention */

  /**
   * Delete rendered outputs older than this many hours. **0 disables it.**
   *
   * Disabled by default deliberately: a developer's `out/` holds work they care
   * about, and a default that quietly deleted it would be indefensible.
   * Production sets `FLARENT_RETENTION_HOURS=72`.
   */
  retentionHours: num(process.env.FLARENT_RETENTION_HOURS, 0),

  /**
   * Refuse new uploads and renders once the data directories exceed this.
   * **0 disables it**, for the same reason retention is disabled by default.
   */
  maxDiskGb: num(process.env.FLARENT_MAX_DISK_GB, 0),

  /** How often the retention sweep runs, in minutes. */
  sweepMinutes: Math.max(1, num(process.env.FLARENT_SWEEP_MINUTES, 30)),

  /* ----------------------------------------------------- PHASE 11 — auth */

  /**
   * The shared access token. Unset means the gate is off, which is what
   * development wants and what every existing test assumes.
   */
  accessToken: process.env.FLARENT_ACCESS_TOKEN || null,

  /** How long a browser session cookie stays valid, in hours. */
  sessionHours: Math.max(1, num(process.env.FLARENT_SESSION_HOURS, 720)),

  /* ------------------------------------------------ PHASE 12 — rate limit */

  /**
   * Expensive POSTs per window, per client. 0 disables.
   *
   * A minute-long window at 60 renders stops a flood dead — a script looping as
   * fast as it can is refused within a second — while never obstructing real
   * work. That distinction matters more than it looks: an MCP session iterating
   * on a reel calls `render_preview` dozens of times in a few minutes, and the
   * first draft of this limit (30 per five minutes) broke the existing render
   * test suite, which is a fair proxy for an agent doing its job. The queue,
   * not the rate limiter, is what bounds concurrent renderer load; this exists
   * to stop the *queue* being filled with thousands of pending jobs.
   */
  rateLimitRenders: num(process.env.FLARENT_RATE_LIMIT_RENDERS, 60),
  rateLimitUploads: num(process.env.FLARENT_RATE_LIMIT_UPLOADS, 120),
  rateWindowMinutes: Math.max(1, num(process.env.FLARENT_RATE_WINDOW_MINUTES, 1)),

  /**
   * Trust `X-Forwarded-For` for the client address.
   *
   * Off by default because trusting that header when nothing is in front of the
   * server lets any caller forge an identity and walk straight through the rate
   * limiter. Behind Caddy it must be on, otherwise every request appears to come
   * from the proxy and the limit becomes global.
   */
  trustProxy: process.env.FLARENT_TRUST_PROXY === '1' ||
    process.env.FLARENT_TRUST_PROXY === 'true',
});

/* ------------------------------------------------------------- directories */

export const ensureDirs = async () => {
  for (const target of [config.outDir, config.uploadDir, config.stateDir]) {
    await fsp.mkdir(target, { recursive: true });
  }
};

/**
 * Move any pre-existing `public/uploads` content to the new upload directory.
 *
 * A one-time, idempotent migration so an existing checkout keeps working: every
 * project already on this machine refers to `uploads/<hash>.<ext>`, and those
 * bytes have to still be there after the directory moves.
 *
 * Safe by construction — filenames are content hashes, so a name that already
 * exists at the destination holds identical bytes and the source is simply
 * dropped. `.gitkeep` stays where it is; it is the tracked file that keeps the
 * directory in git.
 */
export const migrateLegacyUploads = async (log) => {
  const legacy = path.join(config.publicDir, 'uploads');
  if (legacy === config.uploadDir) return 0;
  if (!fs.existsSync(legacy)) return 0;

  let moved = 0;
  for (const name of await fsp.readdir(legacy)) {
    if (name === '.gitkeep' || name.startsWith('.')) continue;
    const from = path.join(legacy, name);
    const to = path.join(config.uploadDir, name);
    try {
      if (!(await fsp.stat(from)).isFile()) continue;
      if (fs.existsSync(to)) {
        // Content-addressed: same name means same bytes. Drop the duplicate.
        await fsp.rm(from, { force: true });
      } else {
        await fsp.rename(from, to);
      }
      moved += 1;
    } catch (error) {
      // A file that will not move is not a reason to refuse to boot; it stays
      // where it is and the operator is told which one.
      log?.('upload.migrate.failed', { name, message: String(error?.message ?? error) });
    }
  }
  return moved;
};

/**
 * Build the directory Remotion bundles as its `public/`.
 *
 * The bundler is given `symlinkPublicDir: true`, which makes the bundle's
 * `public` a symlink rather than a copy — so everything below is read **live
 * from disk at render time**. That is what lets an upload made a second ago
 * appear in a render that reuses a bundle built an hour ago, which is the whole
 * point of PHASE 2 and PHASE 15.
 *
 * The contents are symlinks too, so nothing is duplicated on disk:
 *
 *     <dataDir>/remotion-public/
 *       fonts   -> <root>/public/fonts        (the typeface, via staticFile)
 *       brand   -> <root>/public/brand        (logo objects: /brand/logo-mark.png)
 *       uploads -> <uploadDir>                (everything the user uploaded)
 */
export const ensureRemotionPublicDir = async () => {
  const base = config.remotionPublicDir;
  await fsp.mkdir(base, { recursive: true });

  const links = [
    ['fonts', path.join(config.publicDir, 'fonts')],
    ['brand', path.join(config.publicDir, 'brand')],
    ['uploads', config.uploadDir],
  ];

  for (const [name, target] of links) {
    const link = path.join(base, name);
    let current = null;
    try {
      current = await fsp.readlink(link);
    } catch {
      /* missing, or not a symlink */
    }
    if (current === target) continue;
    // `rm` rather than `unlink` so a stale real directory left by an older
    // build is replaced too, not just a stale link.
    await fsp.rm(link, { recursive: true, force: true });
    if (fs.existsSync(target)) await fsp.symlink(target, link);
  }

  return base;
};

export { DATA_DIR };
