/**
 * The production server, end to end.
 *
 * Spawns the real process against a scratch data directory and drives it over
 * HTTP, because the things being verified here — the access gate, the queue, the
 * static roots, the upload path — are properties of the *server*, and a test
 * that imported the router would not exercise any of them.
 *
 * **The test this file exists for** is `upload after deployment`. The audit
 * found that an asset uploaded once the app was built was served by nothing:
 * `public/uploads` was copied into `dist/` at build time, so the browser saw a
 * build-time snapshot while the renderer read the live directory. The editor
 * showed a broken image and the exported MP4 contained the picture correctly,
 * which is the most confusing shape a bug can have. The three-way assertion at
 * the bottom — uploaded bytes, bytes served to the browser, bytes the renderer
 * drew — is what stops that returning.
 *
 * Render-dependent tests skip themselves when the renderer cannot run, matching
 * `test/render.test.mjs`.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canvas, writePng } from '../server/png.mjs';
import { readPng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* A render is minutes of work; everything else is milliseconds. */
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

let nextPort = 5410;
const servers = [];
let scratch;

/** Start a server with an isolated data directory. Returns its base URL. */
const startServer = async (env = {}) => {
  const port = nextPort++;
  const dataDir = await fsp.mkdtemp(path.join(scratch, 'srv-'));
  const outDir = path.join(dataDir, 'out');
  const uploadDir = path.join(dataDir, 'uploads');
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.mkdir(uploadDir, { recursive: true });

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'render-server.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      FLARENT_RENDER_PORT: String(port),
      FLARENT_DATA_DIR: dataDir,
      FLARENT_OUT_DIR: outDir,
      FLARENT_UPLOAD_DIR: uploadDir,
      FLARENT_HOST: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const base = `http://127.0.0.1:${port}`;
  const handle = { base, child, dataDir, outDir, uploadDir, logs, port, env };
  servers.push(handle);

  // Wait for the port to answer rather than sleeping a guessed interval.
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start on ${port}: ${logs.join('')}`);
    }
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return handle;
};

const stopServer = async (handle) => {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  handle.child.kill('SIGKILL');
  await new Promise((resolve) => handle.child.once('exit', resolve));
};

const scene = (overrides = {}) => ({
  id: 's1',
  text: 'discipline',
  duration: 0.5,
  background: 'cream',
  animation: 'static',
  ...overrides,
});

const post = (base, route, body, headers = {}) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/**
 * Send a request exactly as written, bypassing any client-side URL cleanup.
 *
 * Needed because `fetch` resolves `..` segments before transmitting, which
 * would quietly turn a traversal test into a request for a different path.
 */
const rawRequest = (port, requestLine) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('raw request timed out'));
    });
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });

/** A solid-colour PNG, so a render either drew it or visibly did not. */
const solidPng = (file, rgb, size = 600) => {
  writePng(file, canvas(size, size, rgb));
  return fs.readFileSync(file);
};

let open;
let rendererUp = false;

before(async () => {
  scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'flarent-server-'));
  open = await startServer();

  // One cheap probe decides whether the render-dependent tests can run at all.
  try {
    const response = await post(open.base, '/api/still', { scenes: [scene()], frame: 5 });
    rendererUp = response.ok;
    if (!response.ok) open.logs.push(await response.text());
  } catch {
    rendererUp = false;
  }
});

after(async () => {
  for (const handle of servers) await stopServer(handle);
  await fsp.rm(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------ PHASE 4/5 — rejections */

describe('render endpoint validation', () => {
  it('accepts a valid render and returns a job id', async () => {
    const response = await post(open.base, '/api/render', { scenes: [scene()] });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.match(payload.jobId, /^[0-9a-f-]{36}$/);
    // Do not leave it rendering for the rest of the suite.
    await fetch(`${open.base}/api/render/${payload.jobId}`, { method: 'DELETE' });
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await fetch(`${open.base}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(response.status, 400);
  });

  it('rejects an excessive scene count with 400', async () => {
    const scenes = Array.from({ length: 500 }, (_, i) => scene({ id: `s${i}`, duration: 0.1 }));
    const response = await post(open.base, '/api/render', { scenes });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /limit is/);
  });

  it('rejects an excessive scene duration with 400', async () => {
    const response = await post(open.base, '/api/render', { scenes: [scene({ duration: 100000 })] });
    assert.equal(response.status, 400);
  });

  it('rejects an excessive total frame count with 400', async () => {
    const scenes = Array.from({ length: 60 }, (_, i) => scene({ id: `s${i}`, duration: 12 }));
    const response = await post(open.base, '/api/render', { scenes });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /frames/);
  });

  it('rejects a remote image source with 400 — the SSRF the audit found', async () => {
    const response = await post(open.base, '/api/render', {
      scenes: [scene({ image: { src: 'http://169.254.169.254/latest/meta-data/', placement: 'full' } })],
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.field, /\.src$/);
    assert.match(payload.error, /must not|uploaded asset/i);
  });

  it('accepts a managed uploaded source', async () => {
    const response = await post(open.base, '/api/render', {
      scenes: [scene({ image: { src: 'uploads/deadbeefdeadbeef.png', placement: 'full' } })],
    });
    // Accepted at the validation layer; the file need not exist to prove that.
    assert.equal(response.status, 202);
    const { jobId } = await response.json();
    await fetch(`${open.base}/api/render/${jobId}`, { method: 'DELETE' });
  });
});

/* --------------------------------------------------- PHASE 9 — uploads */

describe('upload endpoint', () => {
  it('stores an image and returns a content-addressed src', async () => {
    const bytes = solidPng(path.join(scratch, 'up.png'), [10, 200, 90], 64);
    const response = await fetch(`${open.base}/api/upload?name=up.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: bytes,
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    assert.equal(payload.src, `uploads/${hash}.png`);
    assert.equal(payload.bytes, bytes.length);
  });

  it('rejects an unsupported type with 415', async () => {
    const response = await fetch(`${open.base}/api/upload?name=evil.exe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-msdownload' },
      body: Buffer.from('MZ'),
    });
    assert.equal(response.status, 415);
  });

  it('rejects an empty upload with 400', async () => {
    const response = await fetch(`${open.base}/api/upload?name=x.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.alloc(0),
    });
    assert.equal(response.status, 400);
  });

  it('enforces the size limit with 413', async () => {
    const small = await startServer({ FLARENT_MAX_UPLOAD_MB: '0.01' });
    const response = await fetch(`${small.base}/api/upload?name=big.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.alloc(200 * 1024),
    });
    assert.equal(response.status, 413);
  });

  it('never uses the client filename on the filesystem', async () => {
    const bytes = solidPng(path.join(scratch, 'trav.png'), [1, 2, 3], 32);
    const response = await fetch(
      `${open.base}/api/upload?name=${encodeURIComponent('../../../../etc/passwd.png')}`,
      { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes },
    );
    assert.equal(response.status, 201);
    const { src } = await response.json();
    assert.match(src, /^uploads\/[0-9a-f]{16}\.png$/);
    assert.equal(src.includes('..'), false);
  });
});

/* -------------------------------------------------- PHASE 10 — disk gate */

describe('disk threshold', () => {
  it('refuses renders and uploads with 507 once the quota is exceeded', async () => {
    const full = await startServer({ FLARENT_MAX_DISK_GB: '0.000001' });

    // Usage is measured per request, so putting something on disk after boot is
    // enough to cross a quota of roughly a kilobyte.
    await fsp.writeFile(path.join(full.outDir, 'existing.mp4'), Buffer.alloc(64 * 1024));

    const render = await post(full.base, '/api/render', { scenes: [scene()] });
    assert.equal(render.status, 507);

    const upload = await fetch(`${full.base}/api/upload?name=x.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: solidPng(path.join(scratch, 'quota.png'), [5, 5, 5], 32),
    });
    assert.equal(upload.status, 507);
  });
});

/* ------------------------------------------------------- PHASE 11 — auth */

describe('access gate', () => {
  it('rejects unauthenticated API, output and upload requests with 401', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'test-token-abc' });

    for (const route of ['/api/render/anything', '/out/x.mp4', '/uploads/x.png']) {
      const response = await fetch(`${locked.base}${route}`);
      assert.equal(response.status, 401, `${route} should be gated`);
    }
    const render = await post(locked.base, '/api/render', { scenes: [scene()] });
    assert.equal(render.status, 401);
  });

  it('leaves /api/health public so a monitor needs no secret', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'test-token-abc' });
    const response = await fetch(`${locked.base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).authRequired, true);
  });

  it('accepts a valid bearer token', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'test-token-abc' });
    const response = await post(
      locked.base, '/api/render', { scenes: [scene()] },
      { Authorization: 'Bearer test-token-abc' },
    );
    assert.equal(response.status, 202);
    const { jobId } = await response.json();
    await fetch(`${locked.base}/api/render/${jobId}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer test-token-abc' },
    });
  });

  it('exchanges the token for an HttpOnly cookie that does not contain it', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'test-token-abc' });

    const form = await fetch(`${locked.base}/__auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=test-token-abc',
      redirect: 'manual',
    });
    assert.equal(form.status, 303);

    const setCookie = form.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.equal(setCookie.includes('test-token-abc'), false,
      'the shared secret must never be sent to the browser');

    const cookie = setCookie.split(';')[0];
    const allowed = await fetch(`${locked.base}/api/render/unknown-id`, { headers: { cookie } });
    assert.equal(allowed.status, 404, 'the cookie should get past the gate to a real 404');
  });

  it('rejects a wrong token at the sign-in form', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'test-token-abc' });
    const response = await fetch(`${locked.base}/__auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=wrong',
      redirect: 'manual',
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  it('never writes the token to its logs', async () => {
    const locked = await startServer({ FLARENT_ACCESS_TOKEN: 'unique-secret-value-xyz' });
    await fetch(`${locked.base}/__auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=unique-secret-value-xyz',
      redirect: 'manual',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(locked.logs.join('').includes('unique-secret-value-xyz'), false);
  });
});

/* ------------------------------------------------ PHASE 12 — rate limits */

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the window is exhausted', async () => {
    const limited = await startServer({
      FLARENT_RATE_LIMIT_RENDERS: '3',
      FLARENT_RATE_WINDOW_MINUTES: '5',
    });

    const codes = [];
    for (let i = 0; i < 5; i++) {
      // Deliberately invalid so nothing is actually rendered — the limiter runs
      // before validation, which is the ordering being asserted.
      const response = await post(limited.base, '/api/render', { scenes: [] });
      codes.push(response.status);
      if (response.status === 429) {
        assert.ok(Number(response.headers.get('retry-after')) > 0);
      }
    }
    assert.equal(codes.filter((code) => code === 429).length >= 2, true,
      `expected refusals after 3 requests, got ${codes.join(',')}`);
  });
});

/* ------------------------------------------------ PHASE 3/8 — serving */

describe('static and output serving', () => {
  it('serves the built editor at / with an SPA fallback', async (t) => {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
      return t.skip('no dist/ build present — run `npm run build` first');
    }
    const root = await fetch(`${open.base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /text\/html/);
    assert.match(await root.text(), /<div id="root">/);

    const deep = await fetch(`${open.base}/some/deep/link`);
    assert.equal(deep.status, 200, 'a deep link should land on the app');

    // A missing *asset* must 404 rather than receive HTML with a 200.
    const missing = await fetch(`${open.base}/assets/does-not-exist.js`);
    assert.equal(missing.status, 404);
    return undefined;
  });

  it('refuses traversal on /out and /uploads', async () => {
    /*
     * Sent down a raw socket rather than through `fetch`.
     *
     * `fetch` normalises `..` out of a URL before it leaves the client, so a
     * literal `/out/../../../etc/passwd` would be rewritten to `/etc/passwd`
     * and never test the server's resolver at all. An attacker does not have
     * that courtesy, so neither does this test.
     */
    for (const route of [
      '/out/../../../etc/passwd',
      '/out/..%2f..%2f..%2fetc%2fpasswd',
      '/out/%2e%2e/%2e%2e/etc/passwd',
      '/uploads/../../../etc/passwd',
      '/uploads/%2e%2e/%2e%2e/etc/passwd',
      '/uploads/....//....//etc/passwd',
    ]) {
      const raw = await rawRequest(open.port, `GET ${route} HTTP/1.1`);
      const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(raw)?.[1]);
      assert.ok(
        status === 400 || status === 404,
        `${route} returned ${status}\n${raw.slice(0, 200)}`,
      );
      assert.equal(raw.includes('root:'), false, 'no /etc/passwd content may be returned');
    }
  });

  it('serves a PNG output as an image, not as video/mp4', async () => {
    await fsp.writeFile(path.join(open.outDir, 'contact-test.png'),
      fs.readFileSync(path.join(scratch, 'up.png')));
    const response = await fetch(`${open.base}/out/contact-test.png`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    assert.equal((response.headers.get('content-disposition') ?? '').includes('attachment'), false);
  });

  it('serves an MP4 output as a download', async () => {
    await fsp.writeFile(path.join(open.outDir, 'flarent-1f-test.mp4'), 'not really a video');
    const response = await fetch(`${open.base}/out/flarent-1f-test.mp4`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /video\/mp4/);
    assert.match(response.headers.get('content-disposition'), /attachment/);
  });

  it('never returns an absolute path in any response body', async () => {
    const health = await (await fetch(`${open.base}/api/health`)).text();
    assert.equal(/\/(Users|home|data|private)\//.test(health), false, health);
  });
});

/* ------------------------------------------------------- PHASE 14 — health */

describe('health endpoint', () => {
  it('reports queue, disk, memory and bundle state', async () => {
    const payload = await (await fetch(`${open.base}/api/health`)).json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.renders.active, 'number');
    assert.equal(typeof payload.renders.queued, 'number');
    assert.equal(typeof payload.renders.concurrency, 'number');
    assert.equal(typeof payload.disk.freeGb, 'number');
    assert.equal(typeof payload.memory.rssMb, 'number');
    assert.equal(typeof payload.bundle.built, 'boolean');
  });
});

/* -------------------------------------------------- PHASE 6 — the queue */

describe('render queue over HTTP', () => {
  it('accepts ten simultaneous renders without starting ten of them', async () => {
    const queued = await startServer({ FLARENT_MAX_CONCURRENT_RENDERS: '1' });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(queued.base, '/api/render', { scenes: [scene()] })),
    );
    const ids = [];
    for (const response of responses) {
      assert.equal(response.status, 202);
      ids.push((await response.json()).jobId);
    }

    const health = await (await fetch(`${queued.base}/api/health`)).json();
    assert.equal(health.renders.concurrency, 1);
    assert.ok(health.renders.active <= 1,
      `at most one render may be active, saw ${health.renders.active}`);
    assert.ok(health.renders.queued >= 1, 'the rest must be queued, not running');

    // A job still in the queue cancels without ever having started.
    const last = ids[ids.length - 1];
    const cancel = await fetch(`${queued.base}/api/render/${last}`, { method: 'DELETE' });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).wasQueued, true);

    const view = await (await fetch(`${queued.base}/api/render/${last}`)).json();
    assert.equal(view.status, 'cancelled');

    for (const id of ids) {
      await fetch(`${queued.base}/api/render/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  });

  it('cancels a running render', async (t) => {
    if (!rendererUp) return t.skip('render server cannot render here');
    const response = await post(open.base, '/api/render', {
      scenes: [scene({ duration: 4 })],
    });
    const { jobId } = await response.json();

    // Wait until it is genuinely past the queue.
    for (let i = 0; i < 100; i++) {
      const view = await (await fetch(`${open.base}/api/render/${jobId}`)).json();
      if (['browser', 'bundling', 'rendering'].includes(view.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const cancel = await fetch(`${open.base}/api/render/${jobId}`, { method: 'DELETE' });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).wasQueued, false);

    const view = await (await fetch(`${open.base}/api/render/${jobId}`)).json();
    assert.equal(view.status, 'cancelled');
    return undefined;
  });
});

/* --------------------------------------------- PHASE 7 — restart recovery */

describe('job persistence across a restart', () => {
  it('does not answer Unknown job merely because the process restarted', async () => {
    const first = await startServer({ FLARENT_MAX_CONCURRENT_RENDERS: '1' });

    const response = await post(first.base, '/api/render', { scenes: [scene({ duration: 3 })] });
    const { jobId } = await response.json();
    // Wait for the snapshot to reach disk before pulling the plug. Not a fixed
    // sleep: render startup can hold the event loop past the 250ms debounce —
    // over a second on a slower Windows machine — and a kill before the first
    // write tests nothing but the machine's speed.
    const jobsFile = path.join(first.dataDir, 'state', 'jobs.json');
    const deadline = Date.now() + 20_000;
    for (;;) {
      let persisted = false;
      try {
        persisted = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).jobs.some((job) => job.jobId === jobId);
      } catch {
        /* not written yet */
      }
      if (persisted) break;
      assert.ok(Date.now() < deadline, 'the job table was never written');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // SIGKILL: the harshest restart, and the one that used to lose everything.
    await stopServer(first);

    const second = await startServer({
      FLARENT_MAX_CONCURRENT_RENDERS: '1',
      FLARENT_DATA_DIR: first.dataDir,
      FLARENT_OUT_DIR: first.outDir,
      FLARENT_UPLOAD_DIR: first.uploadDir,
    });

    const view = await fetch(`${second.base}/api/render/${jobId}`);
    assert.equal(view.status, 200, 'the job must still be known after a restart');
    const payload = await view.json();
    assert.equal(payload.status, 'interrupted');
    assert.equal(payload.retryable, true);
    assert.match(payload.message, /restarted/i);
  });
});

/* =========================================================================
 * The failure the audit found: upload after deployment.
 * ====================================================================== */

describe('an asset uploaded after deployment', () => {
  it('is served to the browser, and rendered from the same bytes', async (t) => {
    if (!rendererUp) return t.skip('render server cannot render here');

    /* 1 — upload, exactly as the editor's ImageControls does. */
    const file = path.join(scratch, 'magenta.png');
    const bytes = solidPng(file, [220, 20, 160], 800);
    const upload = await fetch(`${open.base}/api/upload?name=magenta.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: bytes,
    });
    assert.equal(upload.status, 201);
    const { src } = await upload.json();

    /* 2 — browser preview: GET /uploads/<name> must return those exact bytes.
           This is the request that previously reached nothing at all in
           production, because dist/uploads was a build-time snapshot. */
    const served = await fetch(`${open.base}/${src}`);
    assert.equal(served.status, 200, '/uploads must be served at runtime');
    assert.match(served.headers.get('content-type'), /image\/png/);
    const servedBytes = Buffer.from(await served.arrayBuffer());
    assert.equal(
      createHash('sha1').update(servedBytes).digest('hex'),
      createHash('sha1').update(bytes).digest('hex'),
      'the browser must receive the uploaded bytes, byte for byte',
    );

    /* 3 — the renderer must see the same file. The bundle's public directory is
           a symlink tree, so this is the path Remotion actually reads. */
    const throughBundle = path.join(open.dataDir, 'remotion-public', src);
    assert.equal(fs.existsSync(throughBundle), true,
      'the render bundle must see the upload without a rebuild');
    assert.equal(
      createHash('sha1').update(fs.readFileSync(throughBundle)).digest('hex'),
      createHash('sha1').update(bytes).digest('hex'),
      'the renderer must read the uploaded bytes, byte for byte',
    );

    /* 4 — and it must actually draw it. Rendered against a control with no
           image: if the upload never reached the renderer the two frames are
           identical, which is precisely the silent failure being guarded. */
    const withImage = await post(open.base, '/api/still', {
      scenes: [scene({ image: { src, placement: 'full', scrim: 0, size: 1 } })],
      frame: 7,
    });
    const withPayload = await withImage.json();
    assert.equal(withImage.status, 200, JSON.stringify(withPayload));

    const control = await post(open.base, '/api/still', {
      scenes: [scene()],
      frame: 7,
    });
    assert.equal(control.status, 200);
    const controlPayload = await control.json();

    const readOut = (name) => readPng(path.join(open.outDir, name));
    const drawn = readOut(withPayload.filename);
    const plain = readOut(controlPayload.filename);
    assert.equal(drawn.width, plain.width);

    const different = !Buffer.from(drawn.data).equals(Buffer.from(plain.data));
    assert.equal(different, true,
      'the frame with the uploaded image must differ from the frame without it');

    /* 5 — and the MP4 export must use it too. */
    const render = await post(open.base, '/api/render', {
      scenes: [scene({ duration: 0.5, image: { src, placement: 'full', scrim: 0, size: 1 } })],
    });
    assert.equal(render.status, 202);
    const { jobId } = await render.json();

    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    let final;
    for (;;) {
      if (Date.now() > deadline) throw new Error('render did not finish in time');
      final = await (await fetch(`${open.base}/api/render/${jobId}`)).json();
      if (['done', 'error', 'cancelled', 'interrupted'].includes(final.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(final.status, 'done', final.message ?? '');

    const mp4 = await fetch(`${open.base}${final.url}`);
    assert.equal(mp4.status, 200);
    assert.match(mp4.headers.get('content-type'), /video\/mp4/);
    // The friendly name survives even though the URL itself is opaque.
    assert.match(mp4.headers.get('content-disposition'), /attachment/);
    assert.equal(/\d{16}/.test(final.filename), false);
    const video = Buffer.from(await mp4.arrayBuffer());
    assert.ok(video.length > 1000, 'the exported MP4 should have real content');
    assert.equal(video.subarray(4, 8).toString('ascii'), 'ftyp', 'must be a real MP4 container');

    return undefined;
  });
});
