/**
 * The job table, persisted.
 *
 * It used to be `new Map()` and nothing else, which had a consequence worse than
 * "you lose progress on restart": a render could **finish**, write a perfectly
 * good MP4 to disk, and then become permanently unreachable, because the only
 * record of which file belonged to which job lived in a process that had since
 * exited. The user's video existed and no route could name it.
 *
 * So state is mirrored to one JSON file. No database, by requirement and by
 * good sense — this is a few hundred small records with a single writer.
 *
 * **What honesty requires on restart.** A render that was mid-flight is *gone*:
 * its Chrome is dead and its partial MP4 is garbage. Recording it as `error`
 * would blame the render, and leaving it `rendering` would be a lie that makes
 * clients poll forever. It becomes `interrupted` — a distinct, terminal,
 * explicitly-recoverable state that says what actually happened and invites a
 * retry. Nothing here ever claims a render survived a crash.
 *
 * Durability follows `mcp/lib/store.mjs`: write to a temp file, fsync it, then
 * rename. The rename alone orders the directory entry and not the data behind
 * it, and the failure that produces is a file that parses and then has garbage
 * after it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** States a job can still leave under its own power. */
const LIVE = new Set(['queued', 'starting', 'browser', 'bundling', 'rendering']);

/** Retained records. Old terminal jobs are dropped oldest-first beyond this. */
const MAX_RECORDS = 500;

const isLive = (status) => LIVE.has(status);

export class JobStore {
  #file;
  #jobs = new Map();
  /** jobId -> cancel function. Never persisted; a function has no meaning after restart. */
  #cancels = new Map();
  #writeTimer = null;
  #writing = null;
  #dirty = false;

  constructor(stateDir) {
    this.#file = path.join(stateDir, 'jobs.json');
  }

  /**
   * Load persisted jobs and reconcile them with reality.
   *
   * `outputExists` decides whether a finished job's file is still on disk —
   * retention may have swept it, in which case the job is `expired` rather than
   * `done`, and a client is told the difference instead of being handed a 404
   * from the download route.
   */
  async load(outputExists) {
    let raw;
    try {
      raw = await fsp.readFile(this.#file, 'utf8');
    } catch {
      return { restored: 0, interrupted: 0, expired: 0 };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt table is not worth failing to boot over; it is derived state.
      return { restored: 0, interrupted: 0, expired: 0, corrupt: true };
    }

    let interrupted = 0;
    let expired = 0;
    for (const record of Array.isArray(parsed?.jobs) ? parsed.jobs : []) {
      if (!record?.jobId) continue;
      const job = { ...record };

      if (isLive(job.status)) {
        job.status = 'interrupted';
        job.progress = 0;
        job.message = 'The render server restarted while this job was running. Start it again.';
        job.completedAt = job.completedAt ?? new Date().toISOString();
        interrupted += 1;
      } else if (job.status === 'done' && job.filename && !outputExists(job.filename)) {
        job.status = 'expired';
        job.message = 'The rendered file is no longer available.';
        expired += 1;
      }

      this.#jobs.set(job.jobId, job);
    }

    this.#trim();
    if (interrupted > 0 || expired > 0) this.#schedule();
    return { restored: this.#jobs.size, interrupted, expired };
  }

  create(fields = {}) {
    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      filename: null,
      message: null,
      frames: null,
      ms: null,
      kind: 'render',
      ...fields,
    };
    this.#jobs.set(jobId, job);
    this.#trim();
    this.#schedule();
    return job;
  }

  get(jobId) {
    return this.#jobs.get(jobId) ?? null;
  }

  /**
   * Merge a patch into a job.
   *
   * `cancelled` and `interrupted` are terminal: once set, only a matching status
   * may be written. Cancellation is asynchronous — the DELETE marks the job and
   * fires Remotion's signal, but the signal is only observed once the render is
   * actually running — and without this rule the in-flight progress callbacks
   * ("browser", then "bundling") overwrite the cancelled status and the job
   * resurrects itself and finishes. That is a bug this codebase has already had.
   */
  update(jobId, patch) {
    const current = this.#jobs.get(jobId);
    if (!current) return null;
    if (
      (current.status === 'cancelled' || current.status === 'interrupted') &&
      patch.status !== undefined &&
      patch.status !== current.status
    ) {
      return current;
    }
    const next = { ...current, ...patch };
    this.#jobs.set(jobId, next);
    if (!isLive(next.status)) {
      this.#cancels.delete(jobId);
      // A terminal transition is the state worth not losing; write it now
      // rather than on the debounce.
      this.#schedule(true);
    } else {
      this.#schedule();
    }
    return next;
  }

  setCancel(jobId, cancel) {
    if (this.#jobs.has(jobId)) this.#cancels.set(jobId, cancel);
  }

  takeCancel(jobId) {
    const cancel = this.#cancels.get(jobId);
    this.#cancels.delete(jobId);
    return cancel ?? null;
  }

  /**
   * The job that produced a given output file, or null.
   *
   * Used by `/out/` to recover the friendly download name for an opaque
   * filename. Null is an ordinary answer, not an error: files rendered before
   * opaque names existed, and files whose job has aged out of the table, both
   * land here and fall back to their own name.
   */
  findByFilename(filename) {
    if (typeof filename !== 'string' || filename === '') return null;
    for (const job of this.#jobs.values()) {
      if (job.filename === filename) return job;
    }
    return null;
  }

  /** Jobs that could still produce output — what retention must not delete. */
  activeFilenames() {
    const names = new Set();
    for (const job of this.#jobs.values()) {
      if (isLive(job.status) && job.filename) names.add(job.filename);
    }
    return names;
  }

  counts() {
    let active = 0;
    let queued = 0;
    for (const job of this.#jobs.values()) {
      if (job.status === 'queued') queued += 1;
      else if (isLive(job.status)) active += 1;
    }
    return { active, queued, total: this.#jobs.size };
  }

  /**
   * The client-facing shape of a job.
   *
   * Absolute paths never appear here (PHASE 8/14). `url` is the only file
   * identifier a client gets, and it is relative — which is also what makes it
   * correct behind a reverse proxy at any mount point.
   */
  view(jobId) {
    const job = this.#jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      ...(job.filename ? { filename: job.filename, url: `/out/${job.filename}` } : {}),
      ...(job.message ? { message: job.message } : {}),
      ...(job.frames ? { durationInFrames: job.frames } : {}),
      ...(job.ms ? { ms: job.ms } : {}),
      ...(job.queuePosition !== undefined && job.status === 'queued'
        ? { queuePosition: job.queuePosition }
        : {}),
      ...(job.kind && job.kind !== 'render' ? { kind: job.kind } : {}),
      ...(job.result ? { result: job.result } : {}),
      retryable: job.status === 'error' || job.status === 'interrupted',
    };
  }

  /* --------------------------------------------------------- persistence */

  #trim() {
    if (this.#jobs.size <= MAX_RECORDS) return;
    const terminal = [...this.#jobs.values()]
      .filter((job) => !isLive(job.status))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    let excess = this.#jobs.size - MAX_RECORDS;
    for (const job of terminal) {
      if (excess-- <= 0) break;
      this.#jobs.delete(job.jobId);
    }
  }

  #schedule(immediate = false) {
    this.#dirty = true;
    if (immediate) {
      if (this.#writeTimer) {
        clearTimeout(this.#writeTimer);
        this.#writeTimer = null;
      }
      void this.flush();
      return;
    }
    if (this.#writeTimer) return;
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null;
      void this.flush();
    }, 250);
    // A pending snapshot must never be the reason the process stays alive.
    this.#writeTimer.unref?.();
  }

  /** Write the snapshot. Serialised, so two flushes cannot interleave. */
  async flush() {
    if (this.#writing) {
      await this.#writing;
      if (!this.#dirty) return;
    }
    this.#dirty = false;
    this.#writing = this.#write().catch(() => {
      /* A failed snapshot must not take the server down; state stays in memory. */
    });
    await this.#writing;
    this.#writing = null;
  }

  async #write() {
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      jobs: [...this.#jobs.values()],
    });

    const temp = `${this.#file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fsp.open(temp, 'w');
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await fsp.rename(temp, this.#file);
  }

  /** Test seam: the on-disk file, so a test can restart a store against it. */
  get file() {
    return this.#file;
  }

  /** Drop everything in memory. Used by tests, never by the server. */
  clear() {
    this.#jobs.clear();
    this.#cancels.clear();
  }
}

export const outputExistsIn = (outDir) => (filename) => {
  if (typeof filename !== 'string' || filename === '') return false;
  const safe = path.basename(filename);
  return fs.existsSync(path.join(outDir, safe));
};

export { isLive, LIVE };
