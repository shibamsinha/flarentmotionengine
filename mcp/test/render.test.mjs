/**
 * Rendering: preview stills, the MP4 job lifecycle, and failure handling.
 *
 * These need the Flarent render server running (`npm run dev:render`). When it
 * is not up the suite **skips rather than fails** — a missing optional service
 * is not a broken MCP layer, and a red suite for that reason would train people
 * to ignore it. The one thing always asserted is that the unreachable case
 * produces a retryable SERVICE_UNAVAILABLE with a usable message, because that
 * is the error a real user is most likely to meet.
 */

import './env.mjs';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { connect, fails, makeProject, ok } from './helpers.mjs';
import { health } from '../lib/render-client.mjs';

let client;
let close;
let serverUp = false;

before(async () => {
  ({ client, close } = await connect());
  try {
    await health();
    serverUp = true;
  } catch {
    serverUp = false;
  }
});

after(async () => {
  await close();
});

describe('render server availability', () => {
  it('reports a clear, retryable error when the server is down', async (t) => {
    if (serverUp) {
      const state = await ok(client, 'render_server_health');
      assert.equal(state.reachable, true);
      return;
    }
    const error = await fails(client, 'render_server_health', {}, 'SERVICE_UNAVAILABLE');
    assert.equal(error.retryable, true, 'a down service is worth retrying');
    assert.match(error.message, /npm run dev/, 'the message should say how to start it');
    t.diagnostic('render server is down — the rendering suites will skip');
  });
});

describe('render preview', () => {
  it('returns a real PNG the client can look at', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const result = await ok(client, 'render_preview', { projectId: project.projectId });

    const image = result._result.content.find((block) => block.type === 'image');
    assert.ok(image, 'render_preview must return an image block');
    assert.equal(image.mimeType, 'image/png');

    const bytes = Buffer.from(image.data, 'base64');
    assert.ok(bytes.length > 1000, `a real frame should not be ${bytes.length} bytes`);
    // PNG magic number — proof it is an actual image, not an error page.
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.ok(result.sceneId, 'the caption must say which scene the frame belongs to');
  });

  it('previews a named scene', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const target = project.scenes[2].sceneId;
    const result = await ok(client, 'render_preview', {
      projectId: project.projectId, sceneId: target,
    });
    assert.equal(result.sceneId, target);
  });

  it('rejects being given both a scene and a time', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'render_preview',
      { projectId: project.projectId, sceneId: project.scenes[0].sceneId, atSecond: 1 },
      'VALIDATION_ERROR',
    );
  });
});

describe('render job lifecycle', () => {
  it('starts a job, reports progress and yields a file', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const started = await ok(client, 'render_video', { projectId: project.projectId });
    assert.ok(started.jobId);
    assert.equal(started.status, 'queued');

    // Poll to completion. Generous, because a cold bundle is slow.
    const deadline = Date.now() + 240_000;
    let status;
    while (Date.now() < deadline) {
      status = await ok(client, 'get_render_status', { jobId: started.jobId });
      if (status.status === 'done' || status.status === 'error') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    assert.equal(status.status, 'done', `render did not finish: ${status.message ?? status.status}`);

    const result = await ok(client, 'get_render_result', { jobId: started.jobId });
    assert.match(result.filename, /\.mp4$/);
    assert.ok(result.durationInFrames > 0);
  });

  it('refuses to hand over a result before the job is done', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const started = await ok(client, 'render_video', { projectId: project.projectId });
    // Immediately — the job cannot possibly be finished yet.
    await fails(client, 'get_render_result', { jobId: started.jobId }, 'RENDER_FAILED');
    await ok(client, 'cancel_render', { jobId: started.jobId });
  });

  it('cancels a running job', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    /*
     * Long enough to still be rendering when the cancel arrives.
     *
     * A three-scene reel finishes in well under a second once the bundle is
     * cached, so cancelling it is a race the test loses about half the time —
     * and a flaky test is worse than no test. Twenty scenes is comfortably
     * slower than the round trip.
     */
    const project = await ok(client, 'create_project', {
      title: 'Cancel me',
      scenes: Array.from({ length: 20 }, (_unused, i) => ({ text: `scene ${i}`, duration: 1 })),
    });
    const started = await ok(client, 'render_video', { projectId: project.project.projectId });
    const cancelled = await ok(client, 'cancel_render', { jobId: started.jobId });
    assert.equal(cancelled.status, 'cancelled');

    const status = await ok(client, 'get_render_status', { jobId: started.jobId });
    assert.equal(
      status.status, 'cancelled',
      'a cancelled job must report cancelled, not error — it did not fail, it was stopped',
    );
  });

  it('reports an unknown job id rather than inventing a status', async (t) => {
    if (!serverUp) return t.skip('render server not running');
    await fails(client, 'get_render_status', { jobId: 'no-such-job' }, 'VALIDATION_ERROR');
  });

  it('does not start a second render for a repeated idempotency key', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const key = `render-key-${Date.now()}`;
    const first = await ok(client, 'render_video', { projectId: project.projectId, idempotencyKey: key });
    const second = await ok(client, 'render_video', { projectId: project.projectId, idempotencyKey: key });

    assert.equal(second.jobId, first.jobId, 'a retry must not start a second render');
    assert.equal(second.replayed, true);
    await ok(client, 'cancel_render', { jobId: first.jobId });
  });
});
