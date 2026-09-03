/**
 * Flarent render server.
 *
 * Remotion renders in Node, not in the browser, so the editor posts its scene
 * list here and this process drives @remotion/renderer. Jobs are tracked so the
 * UI can show real progress rather than a spinner.
 *
 *   POST /api/render        { scenes, palette, format, fields, overlay } -> { jobId }
 *   GET  /api/render/:id               -> { status, progress, url, ... }
 *   GET  /out/<file>                   -> the finished MP4
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  renderMedia,
  selectComposition,
} from '@remotion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const ENTRY = path.join(ROOT, 'src', 'remotion', 'index.ts');
const COMPOSITION_ID = 'FlarentVideo';
const PORT = Number(process.env.FLARENT_RENDER_PORT ?? 5174);

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
 * Uploaded the same way images are, into the same `public/uploads` directory:
 * Remotion copies `public/` into the bundle, so the headless render reads
 * exactly the bytes the editor previewed. One asset path, one upload endpoint.
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

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/** Audio gets a larger ceiling: an uncompressed WAV runs ~10MB a minute. */
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

await fsp.mkdir(OUT_DIR, { recursive: true });
await fsp.mkdir(UPLOAD_DIR, { recursive: true });

/* ---------------------------------------------------------------- bundling */

let bundleCache = null; // { serveUrl, signature }

/**
 * Cheap change detector so edits to the engine invalidate the webpack bundle.
 * `public/` is included because Remotion copies it into the bundle — without it
 * a freshly uploaded image would be missing from the render.
 */
const sourceSignature = async () => {
  const stack = [path.join(ROOT, 'src'), PUBLIC_DIR];
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
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    onProgress: (percent) => onProgress(percent / 100),
    webpackOverride: (config) => config,
  });
  bundleCache = { serveUrl, signature };
  return serveUrl;
};

/* -------------------------------------------------------------------- jobs */

/** jobId -> { status, progress, url, filename, message, ms } */
const jobs = new Map();

const slug = (scenes) => {
  const words = scenes
    .flatMap((scene) => String(scene.text ?? '').split(/\s+/))
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return words || 'flarent';
};

const runJob = async (jobId, scenes, palette, fields, overlay, format, audio) => {
  const started = Date.now();
  const set = (patch) => jobs.set(jobId, { ...jobs.get(jobId), ...patch });

  try {
    set({ status: 'browser', progress: 0 });
    await ensureBrowser({
      onBrowserDownload: () => ({
        version: null,
        onProgress: ({ percent }) => set({ progress: percent }),
      }),
    });

    set({ status: 'bundling', progress: 0 });
    const serveUrl = await getBundle((progress) => set({ progress }));

    // `format` drives `calculateFlarentMetadata` inside the bundle, which is
    // what actually decides the render's width/height — omitted entirely
    // rather than sent as 'portrait', so a caller that never heard of formats
    // (an older script, a saved curl command) keeps getting exactly what it
    // always got.
    const inputProps = {
      scenes,
      palette,
      fields,
      ...(overlay ? { overlay } : {}),
      ...(audio ? { audio } : {}),
      ...(format === 'landscape' ? { format } : {}),
    };

    set({ status: 'rendering', progress: 0 });
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
    });

    const filename = `${slug(scenes)}-${composition.durationInFrames}f-${Date.now()
      .toString(36)}.mp4`;
    const outputLocation = path.join(OUT_DIR, filename);

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
      onProgress: ({ progress }) => set({ progress }),
    });

    set({
      status: 'done',
      progress: 1,
      url: `/out/${filename}`,
      filename,
      ms: Date.now() - started,
      durationInFrames: composition.durationInFrames,
    });
    console.log(
      `[flarent] rendered ${filename} (${composition.durationInFrames} frames) in ${(
        (Date.now() - started) / 1000
      ).toFixed(1)}s`,
    );
  } catch (error) {
    console.error('[flarent] render failed:', error);
    set({
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ------------------------------------------------------------------ server */

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const readRaw = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const readBody = async (req) =>
  (await readRaw(req, 8 * 1024 * 1024)).toString('utf8');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, bundled: Boolean(bundleCache) });
  }

  if (url.pathname === '/api/render' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const scenes = Array.isArray(body?.scenes) ? body.scenes : null;
      if (!scenes || scenes.length === 0) {
        return json(res, 400, { error: 'No scenes supplied' });
      }
      const palette = body?.palette === 'ink' ? 'ink' : 'forest';
      const format = body?.format === 'landscape' ? 'landscape' : 'portrait';
      // Only well-formed hex values reach the composition.
      const fields = {};
      if (body?.fields && typeof body.fields === 'object') {
        for (const [name, value] of Object.entries(body.fields)) {
          if (
            ['green', 'cream', 'black'].includes(name) &&
            typeof value === 'string' &&
            /^#[0-9a-f]{6}$/i.test(value)
          ) {
            fields[name] = value;
          }
        }
      }
      /**
       * The project-level static image. Like a scene image it travels as a
       * path, not inlined — and it is only accepted with a `src`, so a
       * half-formed overlay cannot reach the composition.
       */
      let overlay = null;
      if (body?.overlay && typeof body.overlay === 'object' &&
          typeof body.overlay.src === 'string' && body.overlay.src.trim() !== '') {
        const o = body.overlay;
        const n = (v, fallback) =>
          typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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

      /**
       * V7 — the project's audio. Only accepted with a `src` and a positive
       * selection, so a half-formed track cannot reach the composition and
       * cause a render to fail late with a confusing ffmpeg message.
       */
      let audio = null;
      if (body?.audio && typeof body.audio === 'object' &&
          typeof body.audio.src === 'string' && body.audio.src.trim() !== '') {
        const a = body.audio;
        const n = (v, fallback) =>
          typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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

      const jobId = randomUUID();
      jobs.set(jobId, { status: 'starting', progress: 0 });
      // Fire and forget — the client polls for progress.
      void runJob(jobId, scenes, palette, fields, overlay, format, audio);
      return json(res, 202, { jobId });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  /**
   * Images are stored on disk in `public/uploads` and referenced by path, not
   * inlined into inputProps — a couple of base64 photos would blow past any
   * sane request limit, and Remotion copies `public/` into the bundle so the
   * headless render reads exactly the same bytes as the preview.
   */
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    try {
      const declared = String(url.searchParams.get('name') ?? 'image');
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0];
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
      const limit = kind === 'audio' ? MAX_AUDIO_BYTES : MAX_UPLOAD_BYTES;

      const extension =
        table.get(contentType) ?? (known.has(declaredExt) ? declaredExt : null);
      if (!extension) {
        return json(res, 415, {
          error:
            kind === 'audio'
              ? 'Unsupported audio type. Use MP3, WAV, M4A, AAC, OGG, WebM or FLAC.'
              : 'Unsupported image type. Use JPEG, PNG, WebP, AVIF or GIF.',
        });
      }

      const buffer = await readRaw(req, limit);
      if (buffer.length === 0) return json(res, 400, { error: 'Empty upload' });

      // Content-addressed: re-uploading the same picture reuses one file and
      // leaves the bundle cache valid.
      const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 16);
      const filename = `${hash}${extension === '.jpeg' ? '.jpg' : extension}`;
      const target = path.join(UPLOAD_DIR, filename);
      if (!fs.existsSync(target)) await fsp.writeFile(target, buffer);

      console.log(`[flarent] stored uploads/${filename} (${buffer.length} bytes)`);
      return json(res, 201, { src: `uploads/${filename}`, bytes: buffer.length });
    } catch (error) {
      const tooBig = String(error).includes('too large');
      const isAudio = url.searchParams.get('kind') === 'audio';
      const cap = isAudio ? MAX_AUDIO_BYTES : MAX_UPLOAD_BYTES;
      return json(res, tooBig ? 413 : 400, {
        error: tooBig
          ? `${isAudio ? 'Audio' : 'Image'} is larger than ${Math.round(cap / 1024 / 1024)}MB`
          : String(error),
      });
    }
  }

  if (url.pathname.startsWith('/api/render/') && req.method === 'GET') {
    const jobId = url.pathname.slice('/api/render/'.length);
    const job = jobs.get(jobId);
    if (!job) return json(res, 404, { error: 'Unknown job' });
    return json(res, 200, job);
  }

  if (url.pathname.startsWith('/out/') && req.method === 'GET') {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/out/'.length)));
    const file = path.join(OUT_DIR, name);
    if (!file.startsWith(OUT_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    return fs.createReadStream(file).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Flarent render server');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n[flarent] Port ${PORT} is already in use, so the render server cannot start.` +
        '\n[flarent] Usually that means a previous `npm run dev` is still running.' +
        `\n[flarent] Free it with:   lsof -ti:${PORT} | xargs kill` +
        '\n[flarent] Or pick another port:   FLARENT_RENDER_PORT=5184 npm run dev\n',
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`[flarent] render server on http://localhost:${PORT}`);
  console.log(`[flarent] MP4s land in ${OUT_DIR}`);
});
