/**
 * Safety boundaries.
 *
 * §25 of the brief says to treat MCP as a capability boundary and to assume
 * requests may be malicious or malformed. These tests are the evidence for the
 * claims made in `docs/MCP.md` — it is not enough to write "path traversal is
 * rejected" in a document; the rejection has to be demonstrated.
 *
 * The interesting cases are the ones where a *path* reaches the server, since
 * that is the only place this server touches the filesystem on a caller's
 * instruction.
 */

import './env.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resolveAssetPath } from '../lib/assets.mjs';
import { connect, fails, makeProject, ok, rejectsSchema } from './helpers.mjs';
import { readProject } from '../lib/store.mjs';

let client;
let close;

before(async () => {
  ({ client, close } = await connect());
});

after(async () => {
  await close();
});

describe('the tool surface exposes nothing general-purpose', () => {
  it('offers no shell, SQL, filesystem or HTTP escape hatch', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const forbidden of [
      'execute_sql', 'run_command', 'exec', 'shell', 'eval',
      'read_file', 'write_file', 'list_files', 'delete_file',
      'fetch', 'http_request', 'call_api', 'modify_database', 'query',
    ]) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be exposed`);
    }
  });

  it('accepts a filesystem path in exactly one tool', async () => {
    const { tools } = await client.listTools();
    const withPath = tools.filter((tool) =>
      Object.keys(tool.inputSchema.properties ?? {}).includes('path'),
    );
    assert.deepEqual(
      withPath.map((tool) => tool.name), ['add_audio'],
      'only add_audio should take a path; any new one needs its own review',
    );
  });
});

describe('project ids cannot escape the store', () => {
  it('rejects traversal attempts at the schema', async () => {
    for (const id of [
      '../../etc/passwd',
      'prj_../../../etc/passwd',
      '/etc/passwd',
      'prj_000000000000/../../secret',
      '..%2f..%2fetc%2fpasswd',
    ]) {
      await rejectsSchema(client, 'get_project', { projectId: id });
    }
  });

  it('rejects them on destructive tools too', async () => {
    await rejectsSchema(client, 'delete_project', { projectId: '../../x', confirm: true });
  });
});

describe('audio import is a media importer, not a filesystem', () => {
  it('refuses a file whose extension is not an allowed media type', async () => {
    const project = await makeProject(client);
    for (const target of ['/etc/passwd', '/etc/hosts']) {
      if (!fs.existsSync(target)) continue;
      const error = await fails(
        client, 'add_audio', { projectId: project.projectId, path: target }, 'VALIDATION_ERROR',
      );
      assert.match(error.message, /not a supported audio type/i);
      // The rejection must not echo any of the file's contents back.
      assert.ok(!/root:|localhost/.test(JSON.stringify(error)));
    }
  });

  it('refuses a disguised file even with an audio extension', async () => {
    const project = await makeProject(client);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flarent-sec-'));
    const fake = path.join(dir, 'secrets.mp3');
    fs.writeFileSync(fake, 'PRIVATE KEY MATERIAL, not audio at all');
    try {
      // The extension passes, so it is imported — but ffmpeg cannot read a
      // duration from it, and it is rejected before anything is stored on the
      // project. The point: contents are never returned to the caller.
      const error = await fails(
        client, 'add_audio', { projectId: project.projectId, path: fake }, 'VALIDATION_ERROR',
      );
      assert.ok(!/PRIVATE KEY/.test(JSON.stringify(error)), 'contents must never reach the model');

      const audio = await ok(client, 'get_audio', { projectId: project.projectId });
      assert.equal(audio.audio.present, false, 'a rejected file must not be attached');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a directory', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'add_audio', { projectId: project.projectId, path: os.tmpdir() }, 'VALIDATION_ERROR',
    );
  });
});

describe('asset paths inside a document cannot escape public/', () => {
  it('rejects a traversal in a hand-edited audio src', () => {
    for (const src of [
      '../../../etc/passwd',
      'uploads/../../../etc/passwd',
      '/etc/passwd',
    ]) {
      assert.throws(
        () => resolveAssetPath(src),
        (error) => error.code === 'VALIDATION_ERROR',
        `resolveAssetPath should have rejected ${src}`,
      );
    }
  });

  it('rejects a remote URL rather than fetching it', () => {
    assert.throws(
      () => resolveAssetPath('https://example.com/track.mp3'),
      (error) => error.code === 'VALIDATION_ERROR' && /remote URL/i.test(error.message),
    );
  });
});

describe('malformed stored documents fail loudly', () => {
  it('reports CONFLICT rather than rendering something unexpected', async () => {
    const project = await makeProject(client);
    const stored = await readProject(project.projectId);

    // Corrupt it the way a bad hand-edit would.
    const file = path.join(
      process.env.FLARENT_MCP_HOME, 'projects', `${stored.id}.json`,
    );
    fs.writeFileSync(file, JSON.stringify({ title: 'broken', scenes: 'not an array' }));

    await fails(client, 'get_project', { projectId: stored.id }, 'CONFLICT');
  });

  it('lists an unparseable project instead of hiding or throwing', async () => {
    const listed = await ok(client, 'list_projects');
    assert.ok(
      listed.projects.some((row) => row.error === 'unparseable'),
      'a broken project should still appear, marked as broken',
    );
  });
});

describe('destructive operations are gated', () => {
  it('requires confirmation on every destructive tool', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const text = await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'x' });

    await fails(client, 'delete_project', { projectId: project.projectId }, 'CONFIRMATION_REQUIRED');
    await fails(
      client, 'delete_scene', { projectId: project.projectId, sceneId }, 'CONFIRMATION_REQUIRED',
    );
    await fails(
      client, 'remove_element',
      { projectId: project.projectId, sceneId, elementId: text.elementId },
      'CONFIRMATION_REQUIRED',
    );

    // Nothing was destroyed by any of those refusals.
    const after = await ok(client, 'inspect_project', { projectId: project.projectId });
    assert.equal(after.project.sceneCount, 3);
  });

  it('says what would be lost, so the confirmation is informed', async () => {
    const project = await makeProject(client);
    const error = await fails(
      client, 'delete_project', { projectId: project.projectId }, 'CONFIRMATION_REQUIRED',
    );
    assert.match(error.message, /3 scenes/);
    assert.match(error.message, /confirm: true/);
  });
});

describe('rejected imports leave nothing behind', () => {
  it('removes a mislabelled file it copied in, so renders do not bundle it', async () => {
    const project = await makeProject(client);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flarent-orphan-'));
    // Unique bytes, so the content hash cannot collide with a real asset.
    const fake = path.join(dir, 'fake.wav');
    fs.writeFileSync(fake, `not audio ${Date.now()} ${Math.random()}`);

    const uploads = path.join(process.cwd(), 'public', 'uploads');
    const before = fs.existsSync(uploads) ? fs.readdirSync(uploads) : [];

    try {
      await fails(client, 'add_audio', { projectId: project.projectId, path: fake }, 'VALIDATION_ERROR');
      const after = fs.existsSync(uploads) ? fs.readdirSync(uploads) : [];
      assert.deepEqual(
        after.filter((name) => !before.includes(name)), [],
        'a rejected import must not leave a file in public/uploads',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
