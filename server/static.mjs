/**
 * Static file serving.
 *
 * Three roots, three different jobs, one traversal-safe resolver:
 *
 *   dist/       the built editor          (PHASE 3 — no Vite in production)
 *   uploadDir/  runtime user assets       (PHASE 2 — outside public/, served live)
 *   outDir/     rendered MP4s and PNGs    (PHASE 8)
 *
 * The original `/out/` route was already traversal-safe — it ran the request
 * through `path.basename()` — but it hardcoded `Content-Type: video/mp4`, and
 * `out/` holds contact sheets and stills as well as videos, so every PNG it
 * served was mislabelled as a video. `contentType()` fixes that from the
 * extension, which is the only thing that should ever decide it.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.weba': 'audio/webm',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}));

export const contentType = (file) =>
  TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';

/**
 * Resolve a request path inside a root directory, or null.
 *
 * Belt and braces on purpose, because this is the check that stops
 * `/out/../../etc/passwd`:
 *
 *  1. reject percent-encoding that survives one decode, and any NUL;
 *  2. reject `..` segments and absolute/UNC forms outright, rather than
 *     normalising them away — normalising is where the clever bypasses live;
 *  3. resolve, then require the result to sit under `root + sep`.
 *
 * Step 3 alone would be sufficient. Steps 1 and 2 are there so a future edit
 * that weakens one of them still leaves a working check behind.
 */
export const resolveWithin = (root, requestPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  if (decoded.includes('%')) return null; // double-encoded

  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;
  if (parts.some((part) => part.includes('\\'))) return null;

  const base = path.resolve(root);
  const target = path.resolve(base, parts.join(path.sep));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
};

/**
 * Stream a file.
 *
 * `download` sets `Content-Disposition: attachment`, which is what the editor's
 * Export flow has always produced for an MP4. Images are served inline so a
 * contact sheet can simply be opened.
 */
export const sendFile = async (
  req,
  res,
  file,
  { download = false, cacheControl, downloadName } = {},
) => {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const name = path.basename(file);
  const headers = {
    'Content-Type': contentType(file),
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cacheControl ?? 'no-cache',
    // Nothing here should ever be interpreted as HTML by a sniffing browser;
    // `out/` and the upload directory both hold caller-influenced bytes.
    'X-Content-Type-Options': 'nosniff',
  };
  if (download) {
    // The name offered to the browser may differ from the name on disk: output
    // files are opaque so the URL leaks nothing, while the download keeps the
    // reel's own title. Both forms are escaped — a quoted ASCII fallback and the
    // RFC 5987 `filename*` — so a name can never break out of the header.
    const offered = downloadName || name;
    headers['Content-Disposition'] =
      `attachment; filename="${offered.replace(/[^\w.\-]/g, '_')}"; ` +
      `filename*=UTF-8''${encodeURIComponent(offered)}`;
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return true;
  }

  res.writeHead(200, headers);
  await new Promise((resolve) => {
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
};

/**
 * Serve the Vite build, with an SPA fallback.
 *
 * The app has no client-side router — `App.tsx` is a three-state machine and
 * never touches the URL — so the fallback is not routing support so much as
 * insurance: a stray deep link or a refreshed bookmark should land on the
 * editor rather than on a 404 from a server that only knows about `/`.
 *
 * Anything that looks like a missing *asset* still 404s. Returning index.html
 * for `/assets/index-abc.js` would hand the browser HTML with a 200 and produce
 * a syntax error pointing nowhere near the cause.
 */
export const serveDist = async (req, res, pathname, distDir) => {
  if (!fs.existsSync(distDir)) return false;

  const wanted = pathname === '/' ? '/index.html' : pathname;
  const file = resolveWithin(distDir, wanted);
  if (!file) return false;

  if (fs.existsSync(file) && (await fsp.stat(file)).isFile()) {
    // Vite content-hashes everything under /assets, so those can be immutable.
    const immutable = /^\/(assets|fonts)\//.test(pathname);
    return sendFile(req, res, file, {
      cacheControl: immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
  }

  if (path.extname(pathname) !== '') return false;

  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) return false;
  return sendFile(req, res, index, { cacheControl: 'no-cache' });
};
