/**
 * The production-hardening layer, unit level.
 *
 * Fast and server-free: every module here is pure enough to drive directly, so
 * these run in milliseconds and are the tests that should fail first when a
 * limit is weakened. The HTTP behaviour they underpin is covered separately in
 * `test/server.test.mjs`, which spawns the real process.
 *
 * Each assertion that something is *rejected* is paired with one that the
 * legitimate form is *accepted* — a validator that refuses everything would
 * otherwise pass the entire security half of this file.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { assetSrcProblem, validateRenderBody } from '../server/validate.mjs';
import { JobStore, outputExistsIn } from '../server/jobs.mjs';
import { RenderQueue } from '../server/queue.mjs';
import { RateLimiter } from '../server/ratelimit.mjs';
import { contentType, resolveWithin } from '../server/static.mjs';
import { capacity, sweep } from '../server/retention.mjs';
import { isAuthorised, makeSessionValue } from '../server/auth.mjs';

/** The limits the tests below assert against, independent of the environment. */
const limits = {
  maxScenes: 100,
  maxTotalFrames: 3600,
  maxSceneSeconds: 12,
  maxSheetFrames: 36,
};

const scene = (overrides = {}) => ({ text: 'discipline', duration: 1.5, ...overrides });
const body = (overrides = {}) => ({ scenes: [scene()], palette: 'forest', ...overrides });

let scratch;
before(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'flarent-harden-'));
});
after(async () => {
  await fsp.rm(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------- PHASE 4 — limits */

describe('render validation', () => {
  it('accepts an ordinary reel', () => {
    const result = validateRenderBody(body(), limits);
    assert.equal(result.ok, true);
    assert.equal(result.frames, 45); // 1.5s * 30fps
  });

  it('accepts the largest real project shape (31 scenes)', () => {
    const scenes = Array.from({ length: 31 }, () => scene({ duration: 2.8 }));
    const result = validateRenderBody({ scenes }, limits);
    assert.equal(result.ok, true);
  });

  it('rejects a body that is not an object', () => {
    assert.equal(validateRenderBody(null, limits).ok, false);
    assert.equal(validateRenderBody([], limits).ok, false);
  });

  it('rejects missing or empty scenes', () => {
    assert.equal(validateRenderBody({}, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: [] }, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: 'nope' }, limits).ok, false);
  });

  it('rejects an excessive scene count', () => {
    const scenes = Array.from({ length: limits.maxScenes + 1 }, () => scene({ duration: 0.1 }));
    const result = validateRenderBody({ scenes }, limits);
    assert.equal(result.ok, false);
    assert.match(result.error, /limit is 100/);
  });

  it('rejects a scene longer than the ceiling', () => {
    const result = validateRenderBody({ scenes: [scene({ duration: 13 })] }, limits);
    assert.equal(result.ok, false);
    assert.equal(result.field, 'scenes[0].duration');
  });

  it('rejects the three-million-frame request that used to be accepted', () => {
    // The exact payload from the audit: MAX_SCENE_DURATION is a UI constant and
    // buildTimeline never clamped to it, so this reached Remotion unchallenged.
    const result = validateRenderBody({ scenes: [scene({ duration: 100000 })] }, limits);
    assert.equal(result.ok, false);
  });

  it('rejects an excessive total frame count assembled from legal scenes', () => {
    // Each scene is individually fine; the sum is not.
    const scenes = Array.from({ length: 40 }, () => scene({ duration: 12 }));
    const result = validateRenderBody({ scenes }, limits);
    assert.equal(result.ok, false);
    assert.match(result.error, /would render \d+ frames/);
  });

  it('rejects non-finite durations, including the ones JSON can actually carry', () => {
    // JSON has no Infinity literal, but 1e999 parses to one — which is how a
    // non-finite value gets into a payload in practice.
    const parsed = JSON.parse('{"scenes":[{"text":"x","duration":1e999}]}');
    assert.equal(Number.isFinite(parsed.scenes[0].duration), false);
    assert.equal(validateRenderBody(parsed, limits).ok, false);

    assert.equal(validateRenderBody({ scenes: [scene({ duration: -1 })] }, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: [scene({ duration: 0 })] }, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: [scene({ duration: '2' })] }, limits).ok, false);
  });

  it('rejects a non-finite number anywhere in the tree, not just in duration', () => {
    const parsed = JSON.parse('{"scenes":[{"text":"x","duration":1,"objects":[{"x":1e999}]}]}');
    assert.equal(validateRenderBody(parsed, limits).ok, false);
  });

  it('rejects malformed scenes', () => {
    assert.equal(validateRenderBody({ scenes: ['text'] }, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: [null] }, limits).ok, false);
    assert.equal(validateRenderBody({ scenes: [[]] }, limits).ok, false);
  });

  it('rejects an invalid format or palette but accepts both valid values', () => {
    assert.equal(validateRenderBody(body({ format: 'square' }), limits).ok, false);
    assert.equal(validateRenderBody(body({ palette: 'neon' }), limits).ok, false);
    assert.equal(validateRenderBody(body({ format: 'landscape' }), limits).ok, true);
    assert.equal(validateRenderBody(body({ format: 'portrait' }), limits).ok, true);
    assert.equal(validateRenderBody(body({ palette: 'ink' }), limits).ok, true);
  });

  it('rejects invalid audio configuration', () => {
    const audio = (over) => body({ audio: { src: 'uploads/a.mp3', sourceStart: 0, sourceEnd: 5, ...over } });
    assert.equal(validateRenderBody(audio(), limits).ok, true);
    assert.equal(validateRenderBody(audio({ sourceEnd: 0 }), limits).ok, false);
    assert.equal(validateRenderBody(audio({ sourceStart: -1 }), limits).ok, false);
    assert.equal(validateRenderBody(audio({ volume: 4 }), limits).ok, false);
    assert.equal(validateRenderBody(audio({ fadeIn: -2 }), limits).ok, false);
    assert.equal(validateRenderBody(body({ audio: { sourceEnd: 5 } }), limits).ok, false);
    // Explicitly absent audio stays legal — that is every silent reel.
    assert.equal(validateRenderBody(body({ audio: null }), limits).ok, true);
  });

  it('rejects pathological nesting', () => {
    let deep = { text: 'x', duration: 1 };
    let cursor = deep;
    for (let i = 0; i < 40; i++) {
      cursor.child = {};
      cursor = cursor.child;
    }
    assert.equal(validateRenderBody({ scenes: [deep] }, limits).ok, false);
  });
});

/* --------------------------------------------------------- PHASE 5 — SSRF */

describe('asset source allow-list', () => {
  it('accepts managed uploads and bundled brand assets', () => {
    assert.equal(assetSrcProblem('uploads/0511a462e52494f4.png'), null);
    assert.equal(assetSrcProblem('uploads/your-image.jpg'), null);
    assert.equal(assetSrcProblem('/brand/logo-mark.png'), null);
    assert.equal(assetSrcProblem('brand/logo-mark.png'), null);
    // An unset image is how `newObject('image')` starts life.
    assert.equal(assetSrcProblem(''), null);
  });

  it('rejects the cloud metadata endpoint and every other remote URL', () => {
    for (const src of [
      'http://169.254.169.254/latest/meta-data/',
      'https://evil.example.com/x.png',
      'HTTP://EVIL.EXAMPLE.COM/x.png',
      '//evil.example.com/x.png',
      'file:///etc/passwd',
      'http://localhost:5174/api/health',
      'http://127.0.0.1/x',
      'http://[::1]/x',
      'http://10.0.0.1/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
      'http://[fe80::1]/x',
      'http://[fc00::1]/x',
      'ftp://example.com/x',
      'data:image/png;base64,AAAA',
    ]) {
      assert.notEqual(assetSrcProblem(src), null, `${src} should be rejected`);
    }
  });

  it('rejects traversal, encoding tricks and control characters', () => {
    for (const src of [
      'uploads/../../etc/passwd',
      '../secrets.png',
      'uploads/%2e%2e/%2e%2e/etc/passwd',
      'uploads\\..\\x.png',
      'uploads/x.png .txt',
      '/etc/passwd',
      'uploads//x.png',
      'secrets/x.png',
    ]) {
      assert.notEqual(assetSrcProblem(src), null, `${src} should be rejected`);
    }
  });

  it('finds a hostile src nested anywhere in the document, not only at known keys', () => {
    const nested = {
      scenes: [{
        text: 'x',
        duration: 1,
        objects: [{ type: 'group', children: [{ type: 'image', src: 'http://169.254.169.254/' }] }],
      }],
    };
    const result = validateRenderBody(nested, limits);
    assert.equal(result.ok, false);
    assert.match(result.field, /src$/);
  });

  it('rejects a hostile overlay and audio src', () => {
    assert.equal(
      validateRenderBody(body({ overlay: { src: 'https://evil.test/logo.png' } }), limits).ok,
      false,
    );
    assert.equal(
      validateRenderBody(
        body({ audio: { src: 'https://evil.test/a.mp3', sourceStart: 0, sourceEnd: 5 } }),
        limits,
      ).ok,
      false,
    );
  });
});

/* -------------------------------------------------------- PHASE 6 — queue */

describe('render queue', () => {
  const store = () => new JobStore(scratch);

  it('runs no more than the configured number at once', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 2, jobs });
    let running = 0;
    let peak = 0;

    const work = () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return 'ok';
    };

    const ids = Array.from({ length: 10 }, () => jobs.create().jobId);
    await Promise.all(ids.map((id) => queue.submit(id, work())));

    assert.equal(peak, 2, 'ten simultaneous submissions must not run ten at once');
    jobs.clear();
  });

  it('serialises completely at concurrency 1', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 1, jobs });
    let peak = 0;
    let running = 0;
    const ids = Array.from({ length: 5 }, () => jobs.create().jobId);
    await Promise.all(ids.map((id) => queue.submit(id, async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    })));
    assert.equal(peak, 1);
    jobs.clear();
  });

  it('cancels a queued job without ever starting it', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 1, jobs });

    let secondStarted = false;
    const first = jobs.create().jobId;
    const second = jobs.create().jobId;

    const firstDone = queue.submit(first, () =>
      new Promise((resolve) => setTimeout(resolve, 40)));
    const secondDone = queue.submit(second, async () => { secondStarted = true; });

    assert.equal(queue.cancel(second), 'queued');
    await Promise.all([firstDone, secondDone]);

    assert.equal(secondStarted, false, 'a cancelled queued job must never run');
    assert.equal(jobs.get(second).status, 'cancelled');
    jobs.clear();
  });

  it('cancels a running job through the renderer signal', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 1, jobs });
    let cancelled = false;

    const id = jobs.create().jobId;
    const done = queue.submit(id, async () => {
      jobs.setCancel(id, () => { cancelled = true; });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(queue.cancel(id), 'running');
    await done;

    assert.equal(cancelled, true, 'the cancel signal must be fired');
    assert.equal(jobs.get(id).status, 'cancelled');
    jobs.clear();
  });

  it('releases the slot when a job throws', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 1, jobs });

    const failing = jobs.create().jobId;
    await queue.submit(failing, async () => { throw new Error('boom'); }).catch(() => {});

    // A leaked slot would make this hang for ever rather than fail.
    const after = jobs.create().jobId;
    const result = await queue.submit(after, async () => 'ran');
    assert.equal(result, 'ran');
    jobs.clear();
  });

  it('reports queue position and stops accepting on shutdown', async () => {
    const jobs = store();
    const queue = new RenderQueue({ concurrency: 1, jobs });

    const blocking = jobs.create().jobId;
    const waiting = jobs.create().jobId;
    const blocked = queue.submit(blocking, () => new Promise((r) => setTimeout(r, 30)));
    const queued = queue.submit(waiting, async () => 'never');

    assert.equal(jobs.view(waiting).queuePosition, 1);
    assert.equal(queue.stats().queued, 1);

    const dropped = queue.stop();
    assert.equal(dropped, 1);
    assert.equal(jobs.get(waiting).status, 'cancelled');
    await assert.rejects(() => queue.submit(jobs.create().jobId, async () => {}));

    await Promise.all([blocked, queued]);
    jobs.clear();
  });
});

/* -------------------------------------------- PHASE 7 — job persistence */

describe('job persistence', () => {
  it('survives a restart and keeps a finished job downloadable', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'jobs-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir);
    await fsp.writeFile(path.join(outDir, 'flarent-45f-abc.mp4'), 'video');

    const first = new JobStore(dir);
    const job = first.create({ downloadName: 'discipline.mp4' });
    first.update(job.jobId, {
      status: 'done', progress: 1, filename: 'flarent-45f-abc.mp4', frames: 45, ms: 1000,
    });
    await first.flush();

    const second = new JobStore(dir);
    const recovered = await second.load(outputExistsIn(outDir));
    assert.equal(recovered.restored, 1);

    const view = second.view(job.jobId);
    assert.equal(view.status, 'done');
    assert.equal(view.url, '/out/flarent-45f-abc.mp4');
    assert.equal(view.durationInFrames, 45);
  });

  it('turns an interrupted render into an explicit state, never a lie or a 404', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'jobs-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir);

    const first = new JobStore(dir);
    const job = first.create();
    first.update(job.jobId, { status: 'rendering', progress: 0.4 });
    await first.flush();

    const second = new JobStore(dir);
    const recovered = await second.load(outputExistsIn(outDir));

    assert.equal(recovered.interrupted, 1);
    const view = second.view(job.jobId);
    assert.equal(view.status, 'interrupted');
    assert.equal(view.retryable, true);
    assert.notEqual(view, null, 'the job must not vanish merely because the process restarted');
    assert.match(view.message, /restarted/i);
  });

  it('marks a finished job whose file retention removed as expired', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'jobs-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir);

    const first = new JobStore(dir);
    const job = first.create();
    first.update(job.jobId, { status: 'done', filename: 'gone.mp4' });
    await first.flush();

    const second = new JobStore(dir);
    const recovered = await second.load(outputExistsIn(outDir));
    assert.equal(recovered.expired, 1);
    assert.equal(second.view(job.jobId).status, 'expired');
  });

  it('never exposes an absolute path in a job view', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'jobs-'));
    const store = new JobStore(dir);
    const job = store.create();
    store.update(job.jobId, {
      status: 'done', filename: 'flarent-45f-abc.mp4', outputLocation: '/data/out/x.mp4',
    });
    const serialised = JSON.stringify(store.view(job.jobId));
    assert.equal(serialised.includes('/data/out'), false);
    assert.equal(/"[^"]*\/(Users|home|data)\//.test(serialised), false);
  });

  it('keeps a cancelled job cancelled against a late progress callback', () => {
    const store = new JobStore(scratch);
    const job = store.create();
    store.update(job.jobId, { status: 'cancelled' });
    // This is the resurrection bug: an in-flight callback writing "bundling".
    store.update(job.jobId, { status: 'bundling', progress: 0.5 });
    assert.equal(store.get(job.jobId).status, 'cancelled');
  });
});

/* -------------------------------------------------- PHASE 8 — output paths */

describe('output serving', () => {
  it('maps extensions to the right type instead of calling everything an MP4', () => {
    assert.match(contentType('a.mp4'), /video\/mp4/);
    assert.match(contentType('contact-abc.png'), /image\/png/);
    assert.match(contentType('still-abc.png'), /image\/png/);
    assert.match(contentType('track.mp3'), /audio\/mpeg/);
    assert.match(contentType('x.woff2'), /font\/woff2/);
  });

  it('refuses every traversal form', () => {
    const root = path.join(scratch, 'outroot');
    for (const attempt of [
      '../../etc/passwd',
      '..%2f..%2fetc%2fpasswd',
      '%2e%2e/%2e%2e/etc/passwd',
      'a/../../../etc/passwd',
      'x .mp4',
      '..\\..\\windows\\win.ini',
    ]) {
      assert.equal(resolveWithin(root, attempt), null, `${attempt} must not resolve`);
    }
  });

  it('resolves an ordinary filename inside the root', () => {
    const root = path.join(scratch, 'outroot');
    const resolved = resolveWithin(root, 'flarent-45f-abc.mp4');
    assert.equal(resolved, path.join(root, 'flarent-45f-abc.mp4'));
  });
});

/* ------------------------------------------------------- PHASE 10 — disk */

describe('retention and disk capacity', () => {
  it('sweeps aged outputs but never an active job or a fresh file', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'retain-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir, { recursive: true });

    const old = path.join(outDir, 'flarent-old.mp4');
    const fresh = path.join(outDir, 'flarent-fresh.mp4');
    const active = path.join(outDir, 'flarent-active.mp4');
    for (const file of [old, fresh, active]) await fsp.writeFile(file, 'x');

    const longAgo = new Date(Date.now() - 100 * 60 * 60 * 1000);
    await fsp.utimes(old, longAgo, longAgo);
    await fsp.utimes(active, longAgo, longAgo);

    const removed = await sweep(
      { outDir, uploadDir: dir, retentionHours: 72 },
      new Set(['flarent-active.mp4']),
    );

    assert.equal(removed.outputs, 1);
    assert.equal(fs.existsSync(old), false, 'the aged output should be gone');
    assert.equal(fs.existsSync(fresh), true, 'a fresh output must survive');
    assert.equal(fs.existsSync(active), true, 'an in-progress job output must never be deleted');
  });

  it('sweeps stale contact-sheet scaffolding even with retention disabled', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'retain-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir, { recursive: true });
    const temp = path.join(outDir, 'sheet-abc-0.png');
    await fsp.writeFile(temp, 'x');
    const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await fsp.utimes(temp, longAgo, longAgo);

    const removed = await sweep({ outDir, uploadDir: dir, retentionHours: 0 }, new Set());
    assert.equal(removed.temp, 1);
    assert.equal(fs.existsSync(temp), false);
  });

  it('never deletes an upload', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'retain-'));
    const outDir = path.join(dir, 'out');
    const uploadDir = path.join(dir, 'uploads');
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.mkdir(uploadDir, { recursive: true });
    const asset = path.join(uploadDir, 'abc.png');
    await fsp.writeFile(asset, 'x');
    const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 1000);
    await fsp.utimes(asset, longAgo, longAgo);

    await sweep({ outDir, uploadDir, retentionHours: 1 }, new Set());
    assert.equal(fs.existsSync(asset), true, 'uploads are never swept automatically');
  });

  it('refuses new work once the quota is exceeded, and allows it under', async () => {
    const dir = await fsp.mkdtemp(path.join(scratch, 'quota-'));
    const outDir = path.join(dir, 'out');
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'big.mp4'), Buffer.alloc(2 * 1024 * 1024));

    const tiny = await capacity({ outDir, uploadDir: dir, maxDiskGb: 0.001 });
    assert.equal(tiny.ok, false);
    assert.match(tiny.reason, /quota/i);

    const roomy = await capacity({ outDir, uploadDir: dir, maxDiskGb: 100 });
    assert.equal(roomy.ok, true);

    // 0 means "no quota configured", not "a quota of zero".
    const disabled = await capacity({ outDir, uploadDir: dir, maxDiskGb: 0 });
    assert.equal(disabled.ok, true);
  });
});

/* -------------------------------------------------------- PHASE 11 — auth */

describe('access gate', () => {
  const withToken = { accessToken: 'sekrit-token', sessionHours: 1 };

  it('is off when no token is configured', () => {
    assert.equal(isAuthorised({ headers: {} }, { accessToken: null }), true);
  });

  it('accepts the right bearer token and rejects a wrong one', () => {
    assert.equal(
      isAuthorised({ headers: { authorization: 'Bearer sekrit-token' } }, withToken), true);
    assert.equal(
      isAuthorised({ headers: { authorization: 'Bearer wrong' } }, withToken), false);
    // A prefix of the real token must not pass — this is the check a naive
    // `startsWith` or a truncated compare would get wrong.
    assert.equal(
      isAuthorised({ headers: { authorization: 'Bearer sekrit' } }, withToken), false);
    assert.equal(isAuthorised({ headers: {} }, withToken), false);
  });

  it('accepts a session cookie that never contains the token', () => {
    const value = makeSessionValue('sekrit-token', 60_000);
    assert.equal(value.includes('sekrit-token'), false, 'the cookie must not carry the secret');
    assert.equal(
      isAuthorised({ headers: { cookie: `flarent_session=${value}` } }, withToken), true);
  });

  it('rejects a forged, tampered or expired cookie', () => {
    const value = makeSessionValue('sekrit-token', 60_000);
    const [version, expiry, mac] = value.split('.');

    assert.equal(isAuthorised(
      { headers: { cookie: `flarent_session=${version}.${expiry}.${'0'.repeat(mac.length)}` } },
      withToken), false);
    // Extending the expiry invalidates the MAC, which is the point of signing it.
    assert.equal(isAuthorised(
      { headers: { cookie: `flarent_session=${version}.${Number(expiry) + 10 ** 7}.${mac}` } },
      withToken), false);
    assert.equal(isAuthorised(
      { headers: { cookie: `flarent_session=${makeSessionValue('sekrit-token', -1000)}` } },
      withToken), false);
    // A cookie minted under a different token is worthless.
    assert.equal(isAuthorised(
      { headers: { cookie: `flarent_session=${makeSessionValue('other', 60_000)}` } },
      withToken), false);
  });
});

/* ------------------------------------------------- PHASE 12 — rate limits */

describe('rate limiting', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 3; i++) {
      assert.equal(limiter.check('a', 3).allowed, true, `request ${i + 1} should pass`);
    }
    const blocked = limiter.check('a', 3);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.resetMs > 0);
  });

  it('keys clients separately', () => {
    const limiter = new RateLimiter(5);
    limiter.check('a', 1);
    assert.equal(limiter.check('a', 1).allowed, false);
    assert.equal(limiter.check('b', 1).allowed, true);
  });

  it('treats a limit of zero as disabled', () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 100; i++) {
      assert.equal(limiter.check('a', 0).allowed, true);
    }
  });
});
