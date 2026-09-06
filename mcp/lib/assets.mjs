/**
 * Importing a media file into the project.
 *
 * **The capability boundary, stated plainly.** §25 forbids arbitrary filesystem
 * access, and this module reads a file the caller names — so it is worth being
 * exact about why that is not the same thing. This can only:
 *
 *   - read *one* file, at a path the user's own agent supplied;
 *   - of an extension on a fixed allow-list of media types;
 *   - under a size cap;
 *   - and copy it to exactly one destination, `public/uploads/`.
 *
 * It cannot list directories, read arbitrary bytes back to the model, write
 * anywhere else, or follow a path the model invented into somewhere sensitive
 * and return the contents. The file's *bytes never reach the model* — only its
 * duration, tempo and a hashed filename. That is an intentional import
 * capability rather than a filesystem.
 *
 * Destination and naming deliberately mirror `server/render-server.mjs`:
 * content-addressed by SHA-1, into `public/uploads`, because Remotion copies
 * `public/` into the render bundle. Re-importing the same track reuses one file,
 * which keeps the render server's bundle cache valid.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ROOT } from './engine.mjs';
import { validationError } from './errors.mjs';

const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');

/** The same vocabularies the render server accepts, for the same reasons. */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.weba', '.flac']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/**
 * Bring a local media file into the project.
 *
 * Returns the `uploads/…` path the engine stores — the same shape the editor's
 * upload endpoint returns, so a project authored here is indistinguishable from
 * one authored in the browser.
 */
export const importAsset = async (sourcePath, kind = 'audio') => {
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
    throw validationError('Supply the path to a file on this machine.');
  }

  // Resolve before anything else, so every later check sees the real target
  // rather than a relative path that means something different here.
  const absolute = path.resolve(sourcePath.trim());
  const extension = path.extname(absolute).toLowerCase();
  const allowed = kind === 'audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
  const limit = kind === 'audio' ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;

  if (!allowed.has(extension)) {
    throw validationError(
      `"${extension || 'no extension'}" is not a supported ${kind} type. ` +
        `Use one of: ${[...allowed].join(', ')}.`,
      { path: path.basename(absolute), supported: [...allowed] },
    );
  }

  let stat;
  try {
    stat = await fsp.stat(absolute);
  } catch {
    throw validationError(`No file at ${absolute}.`, { path: absolute });
  }
  if (!stat.isFile()) {
    throw validationError(`${absolute} is not a file.`, { path: absolute });
  }
  if (stat.size === 0) {
    throw validationError('That file is empty.', { path: absolute });
  }
  if (stat.size > limit) {
    throw validationError(
      `That ${kind} is ${Math.round(stat.size / 1024 / 1024)}MB, over the ` +
        `${Math.round(limit / 1024 / 1024)}MB limit.`,
      { bytes: stat.size, limit },
    );
  }

  const bytes = await fsp.readFile(absolute);
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const filename = `${hash}${extension === '.jpeg' ? '.jpg' : extension}`;

  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const target = path.join(UPLOAD_DIR, filename);
  const created = !fs.existsSync(target);
  if (created) await fsp.writeFile(target, bytes);

  return {
    // What goes in the document: a path relative to `public/`, as the engine
    // and the render server both expect.
    src: `uploads/${filename}`,
    absolutePath: target,
    name: path.basename(absolute),
    bytes: stat.size,
    /*
     * Whether this call put the file there.
     *
     * The extension allow-list is checked before reading, but whether the bytes
     * are *really* audio is only known once ffmpeg has looked at them — by which
     * point the file has been copied in. A caller that then rejects the import
     * uses this to clean up, so a mislabelled file does not sit in
     * `public/uploads` for ever, getting copied into every render bundle.
     *
     * False means the content was already there under its hash, so some other
     * project may be using it: leave it alone.
     */
    created,
  };
};

/** Remove an asset this process just imported. Never touches a pre-existing one. */
export const discardAsset = async (asset) => {
  if (!asset?.created || !asset.absolutePath) return false;
  try {
    await fsp.rm(asset.absolutePath, { force: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * The absolute path of an asset the document refers to.
 *
 * Rejects anything that escapes `public/`, so a hand-edited or model-supplied
 * `src` cannot walk up into the rest of the disk.
 */
export const resolveAssetPath = (src) => {
  if (typeof src !== 'string' || src.trim() === '') {
    throw validationError('That project has no usable audio source.');
  }
  if (/^https?:\/\//i.test(src)) {
    throw validationError(
      'That audio is a remote URL. Analysis needs a local file — re-add it with add_audio ' +
        'pointing at a file on this machine.',
      { src },
    );
  }

  const publicDir = path.join(ROOT, 'public');
  const absolute = path.resolve(publicDir, src.replace(/^\/+/, ''));
  if (!absolute.startsWith(publicDir + path.sep)) {
    throw validationError('That audio path points outside the project.', { src });
  }
  if (!fs.existsSync(absolute)) {
    throw validationError(
      `The audio file ${src} is missing from the project. It may have been deleted from ` +
        'public/uploads; re-add it with add_audio.',
      { src },
    );
  }
  return absolute;
};

export { UPLOAD_DIR, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS };
