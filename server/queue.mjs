/**
 * The render queue.
 *
 * `POST /api/render` used to call `void runJob(...)` unconditionally, so ten
 * simultaneous requests started ten Remotion renders, each of which opens
 * several headless Chrome tabs at 1080×1920. On a 4-core box that is not slow,
 * it is an out-of-memory kill — and the endpoint was unauthenticated, which made
 * it a one-line denial of service.
 *
 * This is the admission control. In-process on purpose: the requirement is to
 * stop one machine over-committing itself, and a Redis for that would be a
 * second thing to run, monitor and lose data in, solving a problem this
 * deployment does not have.
 *
 * **A queued job is a real job.** It has an id and a status from the moment it
 * is accepted, so the client's existing poll loop works unchanged whether the
 * render started immediately or is third in line. `queuePosition` is maintained
 * so the UI *can* say "2 ahead of you" without the server having to guess what
 * the UI wants.
 *
 * **Cancelling a queued job never starts it.** The pending entry is removed and
 * the job goes terminal without a browser ever opening — which is the case that
 * matters most, because it is the one that saves the machine actual work.
 */

export class RenderQueue {
  #concurrency;
  #jobs;
  #pending = [];
  #running = new Set();
  #accepting = true;

  constructor({ concurrency, jobs }) {
    this.#concurrency = Math.max(1, concurrency);
    this.#jobs = jobs;
  }

  get accepting() {
    return this.#accepting;
  }

  stats() {
    return {
      running: this.#running.size,
      queued: this.#pending.length,
      concurrency: this.#concurrency,
      accepting: this.#accepting,
    };
  }

  /**
   * Accept a job.
   *
   * `task` is `async ({ onCancel, cancelled }) => result`. It is called only
   * when a slot is free, and never at all if the job was cancelled while queued.
   * The returned promise resolves when the task settles; the HTTP layer normally
   * ignores it (the client polls) but the synchronous still/contact-sheet paths
   * await it.
   */
  submit(jobId, task) {
    if (!this.#accepting) {
      return Promise.reject(new Error('The render server is shutting down.'));
    }
    return new Promise((resolve, reject) => {
      this.#pending.push({ jobId, task, resolve, reject });
      this.#renumber();
      this.#pump();
    });
  }

  /**
   * Cancel a queued or running job.
   *
   * Returns 'queued' if it was removed before starting, 'running' if the
   * renderer's own cancel signal was fired, or null if there was nothing to do.
   */
  cancel(jobId) {
    const index = this.#pending.findIndex((entry) => entry.jobId === jobId);
    if (index !== -1) {
      const [entry] = this.#pending.splice(index, 1);
      this.#renumber();
      this.#jobs.update(jobId, {
        status: 'cancelled',
        progress: 0,
        message: 'Cancelled before it started.',
        completedAt: new Date().toISOString(),
      });
      // Resolve rather than reject: a deliberate cancellation is not an error,
      // and a rejected promise nobody awaits is an unhandled rejection.
      entry.resolve({ cancelled: true });
      return 'queued';
    }

    if (this.#running.has(jobId)) {
      const cancel = this.#jobs.takeCancel(jobId);
      /*
       * Remotion's own signal, never a process kill: the renderer needs to close
       * its headless Chrome and clean up the partial file, and killing it would
       * orphan both. The signal is only observed once the render is actually
       * running, which is why the job is marked cancelled here as well — the
       * store treats that status as terminal so in-flight progress callbacks
       * cannot overwrite it.
       */
      this.#jobs.update(jobId, { status: 'cancelled', progress: 0 });
      try {
        cancel?.();
      } catch {
        /* Already finishing — the status above is still the right answer. */
      }
      return 'running';
    }

    return null;
  }

  /**
   * Stop accepting work.
   *
   * Queued jobs are cancelled rather than left in a table that outlives the
   * process as `interrupted`; they never started, so saying so is both cheaper
   * and truer. Running renders are left alone — the caller decides whether to
   * wait for them or exit.
   */
  stop() {
    this.#accepting = false;
    const drained = this.#pending.splice(0);
    this.#renumber();
    for (const entry of drained) {
      this.#jobs.update(entry.jobId, {
        status: 'cancelled',
        progress: 0,
        message: 'The render server shut down before this job started.',
        completedAt: new Date().toISOString(),
      });
      entry.resolve({ cancelled: true });
    }
    return drained.length;
  }

  /** Resolves once every running job has settled. */
  async drain() {
    while (this.#running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  #renumber() {
    this.#pending.forEach((entry, index) => {
      this.#jobs.update(entry.jobId, { queuePosition: index + 1 });
    });
  }

  #pump() {
    while (this.#running.size < this.#concurrency && this.#pending.length > 0) {
      const entry = this.#pending.shift();
      this.#renumber();
      this.#run(entry);
    }
  }

  async #run(entry) {
    const { jobId, task, resolve, reject } = entry;
    this.#running.add(jobId);
    this.#jobs.update(jobId, { queuePosition: undefined });

    try {
      resolve(await task());
    } catch (problem) {
      reject(problem);
    } finally {
      /*
       * The slot is released here and only here, so every exit path — success,
       * failure, cancellation, an exception from the task itself — frees it.
       * A slot leaked on the error path is a server that renders N times and
       * then stops for ever, which is the worst possible failure for a queue.
       */
      this.#running.delete(jobId);
      this.#pump();
    }
  }
}
