/**
 * Disk retention and capacity.
 *
 * One developer produced 93MB of MP4 and 10MB of PNG in about two weeks, and
 * nothing in the server had ever deleted a byte. Left alone on a small VPS that
 * is a slow, certain outage: the disk fills, renders start failing at the write,
 * and the failure surfaces as a confusing ffmpeg error rather than as "you are
 * out of space".
 *
 * Two rules shape everything here.
 *
 * **Conservative about outputs.** A file is only swept if it is older than the
 * retention window *and* no live job claims it. Age is taken from `mtime`.
 *
 * **Uploads are never swept automatically, and that is a deliberate refusal.**
 * The obvious next step — delete uploads nothing references — cannot be done
 * safely in this architecture, because the thing that references them is a
 * project in a *browser's* localStorage. The server has never seen it and
 * cannot enumerate it. Any "unused" test the server could run would be a guess,
 * and being wrong means silently destroying an asset a user's project still
 * points at. So uploads are reported and never deleted; reclaiming them stays a
 * deliberate operator action.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const HOUR_MS = 60 * 60 * 1000;

/** Temp frames written by the contact-sheet path; scaffolding, never a result. */
const TEMP_PREFIX = 'sheet-';
const TEMP_MAX_AGE_MS = HOUR_MS;

const bytesOf = async (dir) => {
  let total = 0;
  let files = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = await fsp.stat(path.join(dir, entry.name));
      total += stat.size;
      files += 1;
    } catch {
      /* raced with a delete */
    }
  }
  return { bytes: total, files };
};

/** Free space on the volume holding `dir`, or null where unsupported. */
export const freeBytes = async (dir) => {
  try {
    const stat = await fsp.statfs(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
};

export const usage = async (config) => {
  const [out, uploads] = await Promise.all([
    bytesOf(config.outDir),
    bytesOf(config.uploadDir),
  ]);
  const free = await freeBytes(config.outDir);
  return {
    outBytes: out.bytes,
    outFiles: out.files,
    uploadBytes: uploads.bytes,
    uploadFiles: uploads.files,
    totalBytes: out.bytes + uploads.bytes,
    freeBytes: free,
  };
};

/**
 * Is there room to accept new work?
 *
 * Two independent tests, because they fail for different reasons: the configured
 * quota is about this application's share of the disk, and the free-space floor
 * is about the machine — another service can fill a volume this one is nowhere
 * near its quota on.
 */
export const capacity = async (config) => {
  const stats = await usage(config);

  if (config.maxDiskGb > 0) {
    const limit = config.maxDiskGb * 1024 ** 3;
    if (stats.totalBytes >= limit) {
      return {
        ok: false,
        reason: 'Storage quota reached. Old renders must be cleared before new ones can start.',
        stats,
      };
    }
  }

  // A floor that holds regardless of configuration: below this, a render cannot
  // reliably write its output anyway.
  if (stats.freeBytes !== null && stats.freeBytes < 512 * 1024 * 1024) {
    return { ok: false, reason: 'The server is out of disk space.', stats };
  }

  return { ok: true, stats };
};

/**
 * Delete aged outputs and stale temp frames.
 *
 * `protectedNames` is the set of filenames belonging to jobs that are still
 * queued or running — sweeping one of those would delete a file out from under
 * a render that is still writing it.
 */
export const sweep = async (config, protectedNames = new Set()) => {
  const removed = { outputs: 0, temp: 0, bytes: 0 };
  const now = Date.now();

  let entries;
  try {
    entries = await fsp.readdir(config.outDir, { withFileTypes: true });
  } catch {
    return removed;
  }

  const maxAgeMs = config.retentionHours > 0 ? config.retentionHours * HOUR_MS : null;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === '.gitkeep' || name.startsWith('.')) continue;
    if (protectedNames.has(name)) continue;

    const file = path.join(config.outDir, name);
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      continue;
    }
    const age = now - stat.mtimeMs;

    // Contact-sheet scaffolding is swept on its own short clock, whether or not
    // retention is configured: it is never a result, so keeping it is only ever
    // a leak from a crashed request.
    const isTemp = name.startsWith(TEMP_PREFIX);
    const expired = isTemp ? age > TEMP_MAX_AGE_MS : maxAgeMs !== null && age > maxAgeMs;
    if (!expired) continue;

    try {
      await fsp.rm(file, { force: true });
      removed[isTemp ? 'temp' : 'outputs'] += 1;
      removed.bytes += stat.size;
    } catch {
      /* another process got there first */
    }
  }

  return removed;
};

export const outputExists = (config, filename) => {
  if (typeof filename !== 'string' || filename === '') return false;
  return fs.existsSync(path.join(config.outDir, path.basename(filename)));
};
