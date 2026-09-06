/**
 * The V8 capabilities, through MCP.
 *
 * These check the *interface*, not the engine: that the new fields are
 * reachable semantically, that they survive the store's round trip, and that
 * the precedence rules a client depends on hold. The engine's own behaviour is
 * covered by `test/engine.test.mjs` and `test/render.test.mjs`.
 */

import './env.mjs';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { connect, fails, makeProject, ok, rejectsSchema } from './helpers.mjs';

let client;
let close;

before(async () => {
  ({ client, close } = await connect());
});

after(async () => {
  await close();
});

describe('custom palette', () => {
  it('sets an arbitrary background and ink, and reports them back', async () => {
    const project = await makeProject(client);
    const result = await ok(client, 'set_palette', {
      projectId: project.projectId,
      background: { green: '#1A0DCC' },
      ink: { green: '#FFFFFF' },
      accent: '#00A8FF',
    });

    assert.deepEqual(result.palette.background, { green: '#1A0DCC' });
    assert.deepEqual(result.palette.ink, { green: '#FFFFFF' });
    assert.equal(result.palette.accent, '#00A8FF');

    // And it survives a reload, which is the part that would break silently.
    const reloaded = await ok(client, 'inspect_project', { projectId: project.projectId });
    assert.deepEqual(reloaded.project.palette.ink, { green: '#FFFFFF' });
    assert.equal(reloaded.project.palette.accent, '#00A8FF');
  });

  it('merges by default and replaces on request', async () => {
    const project = await makeProject(client);
    await ok(client, 'set_palette', { projectId: project.projectId, background: { green: '#111111' } });
    const merged = await ok(client, 'set_palette', {
      projectId: project.projectId, background: { cream: '#FFFFFF' },
    });
    assert.deepEqual(merged.palette.background, { green: '#111111', cream: '#FFFFFF' });

    const replaced = await ok(client, 'set_palette', {
      projectId: project.projectId, background: { black: '#000011' }, merge: false,
    });
    assert.deepEqual(replaced.palette.background, { black: '#000011' });
  });

  it('clears back to the house palette with null', async () => {
    const project = await makeProject(client);
    await ok(client, 'set_palette', {
      projectId: project.projectId, background: { green: '#1A0DCC' }, accent: '#00A8FF',
    });
    const cleared = await ok(client, 'set_palette', {
      projectId: project.projectId, background: null, accent: null,
    });
    assert.deepEqual(cleared.palette.background, {});
    assert.equal(cleared.palette.accent, null);
  });

  it('rejects a malformed colour and an unknown field', async () => {
    const project = await makeProject(client);
    await rejectsSchema(client, 'set_palette', {
      projectId: project.projectId, background: { green: 'blue' },
    });
    await rejectsSchema(client, 'set_palette', {
      projectId: project.projectId, background: { magenta: '#FF00FF' },
    });
    await fails(client, 'set_palette', { projectId: project.projectId }, 'VALIDATION_ERROR');
  });

  it('reports the palette name as derived, so a model does not try to set it', async () => {
    const project = await makeProject(client);
    const inspected = await ok(client, 'inspect_project', { projectId: project.projectId });
    assert.equal(inspected.project.palette.nameIsDerived, true);
  });
});

describe('animation: none over MCP', () => {
  it('is offered in the schema alongside the animated styles', async () => {
    const { tools } = await client.listTools();
    const updateScene = tools.find((tool) => tool.name === 'update_scene');
    assert.ok(
      updateScene.inputSchema.properties.style.enum.includes('none'),
      'the style enum must come from the engine registry',
    );
  });

  it('round-trips as a scene style', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, style: 'none',
    });
    assert.equal(updated.scene.style, 'none');

    const reloaded = await ok(client, 'inspect_scene', { projectId: project.projectId, sceneId });
    assert.equal(reloaded.scene.style, 'none');
  });
});

describe('frame-based durations', () => {
  it('sets an exact frame count', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    for (const frames of [1, 2, 7, 30]) {
      const result = await ok(client, 'set_scene_duration', {
        projectId: project.projectId, sceneId, durationInFrames: frames,
      });
      const scene = result.project.scenes.find((row) => row.sceneId === sceneId);
      assert.equal(scene.frames, frames, `expected exactly ${frames} frames`);
    }
  });

  it('lets frames win when both units are given', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const result = await ok(client, 'set_scene_duration', {
      projectId: project.projectId, sceneId, duration: 5, durationInFrames: 7,
    });
    const scene = result.project.scenes.find((row) => row.sceneId === sceneId);
    assert.equal(scene.frames, 7, 'frames must take precedence over seconds');
  });

  it('creates a scene by frame count', async () => {
    const project = await makeProject(client);
    const created = await ok(client, 'create_scene', {
      projectId: project.projectId, text: 'fast cut', durationInFrames: 7,
    });
    assert.equal(created.scene.frames, 7);
  });

  it('requires one of the two units', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'set_scene_duration',
      { projectId: project.projectId, sceneId: project.scenes[0].sceneId },
      'VALIDATION_ERROR',
    );
  });
});

describe('entrance duration, fit and the accent face over MCP', () => {
  it('sets all three on a text element and reads them back', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    const added = await ok(client, 'add_text', {
      projectId: project.projectId, sceneId, text: 'consistency',
      enterFrames: 2, fitWidth: 0.88, fontRole: 'accent',
    });

    const scene = await ok(client, 'inspect_scene', { projectId: project.projectId, sceneId });
    const element = scene.scene.elements.find((el) => el.elementId === added.elementId);
    assert.equal(element.enterFrames, 2);
    assert.equal(element.fitWidth, 0.88);
    assert.equal(element.fontRole, 'accent');
  });

  it('sets them at scene level too, as a default for every element', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, enterFrames: 3, fitWidth: 0.8, fontRole: 'accent',
    });
    assert.equal(updated.scene.enterFrames, 3);
    assert.equal(updated.scene.fitWidth, 0.8);
    assert.equal(updated.scene.fontRole, 'accent');
  });

  it('rejects values the engine cannot honour', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    // Zero-frame and fractional entrances are meaningless on a frame grid.
    await rejectsSchema(client, 'update_scene', { projectId: project.projectId, sceneId, enterFrames: 0 });
    await rejectsSchema(client, 'update_scene', { projectId: project.projectId, sceneId, enterFrames: 1.5 });
    // A fit wider than the frame is not a fit.
    await rejectsSchema(client, 'update_scene', { projectId: project.projectId, sceneId, fitWidth: 1.4 });
    // There is no font-loading path, so a family name is not a role.
    await rejectsSchema(client, 'update_scene', { projectId: project.projectId, sceneId, fontRole: 'Georgia' });
  });

  it('still reports per-property font control as unsupported', async () => {
    const error = await fails(
      client, 'set_font_property', { property: 'letterSpacing' }, 'UNSUPPORTED_CAPABILITY',
    );
    assert.ok(error.message.length > 20);
  });
});

describe('V8 fields survive the store round trip', () => {
  it('keeps everything after several unrelated edits', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    await ok(client, 'set_palette', {
      projectId: project.projectId, background: { cream: '#FFFFFF' }, ink: { cream: '#1A0DCC' },
    });
    await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, style: 'none', enterFrames: 2, fontRole: 'accent',
    });
    await ok(client, 'add_text', {
      projectId: project.projectId, sceneId, text: 'held', fitWidth: 0.88,
    });

    // Unrelated churn.
    await ok(client, 'update_project', { projectId: project.projectId, title: 'Renamed' });
    await ok(client, 'create_scene', { projectId: project.projectId, text: 'another' });

    const raw = await ok(client, 'get_flarent_json', { projectId: project.projectId });
    assert.deepEqual(raw.document.inkPalette, { cream: '#1A0DCC' });
    assert.equal(raw.document.scenes[0].animation, 'NONE');
    assert.equal(raw.document.scenes[0].enterFrames, 2);
    assert.equal(raw.document.scenes[0].fontRole, 'ACCENT');
    assert.deepEqual(raw.document.scenes[0].elements[0].fit, { mode: 'WIDTH', maxWidth: 0.88 });
  });
});

/* ------------------------------------------------------- V8.2 (phase two) */

describe('text exits over MCP', () => {
  it('sets an explicit exit and exit length', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, style: 'punch', exit: 'slide', exitFrames: 4,
    });
    assert.equal(updated.scene.exit, 'slide');
    assert.equal(updated.scene.exitFrames, 4);
  });

  it('expresses all four enter/exit combinations', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    for (const [style, exit] of [
      ['punch', 'punch'], ['punch', 'none'], ['none', 'punch'], ['none', 'none'],
    ]) {
      const updated = await ok(client, 'update_scene', {
        projectId: project.projectId, sceneId, style, exit,
      });
      assert.equal(updated.scene.style, style);
      assert.equal(updated.scene.exit, exit);
    }
  });

  it('rejects an exit the engine does not have', async () => {
    const project = await makeProject(client);
    await rejectsSchema(client, 'update_scene', {
      projectId: project.projectId, sceneId: project.scenes[0].sceneId, exit: 'dissolve',
    });
  });
});

describe('word stagger over MCP', () => {
  it('sets spacing and order, and reports them back', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, staggerFrames: 2, staggerOrder: 'reverse',
    });
    assert.deepEqual(updated.scene.stagger, { delayFrames: 2, order: 'reverse' });

    const reloaded = await ok(client, 'inspect_scene', { projectId: project.projectId, sceneId });
    assert.equal(reloaded.scene.stagger.delayFrames, 2);
    assert.equal(reloaded.scene.stagger.order, 'reverse');
  });

  it('treats forward as the default rather than storing it', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, staggerFrames: 3, staggerOrder: 'forward',
    });
    const raw = await ok(client, 'get_flarent_json', { projectId: project.projectId });
    assert.equal(raw.document.scenes[0].stagger.order, undefined);
    assert.equal(raw.document.scenes[0].stagger.delayFrames, 3);
  });

  it('rejects a fractional or negative spacing', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await rejectsSchema(client, 'update_scene', {
      projectId: project.projectId, sceneId, staggerFrames: 1.5,
    });
    await rejectsSchema(client, 'update_scene', {
      projectId: project.projectId, sceneId, staggerFrames: -1,
    });
  });
});

describe('background alternation over MCP', () => {
  it('sets an interval and an optional flip limit', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId,
      backgroundEveryFrames: 4, backgroundTimes: 6,
    });
    assert.deepEqual(updated.scene.backgroundMotion, {
      mode: 'alternate', everyFrames: 4, times: 6,
    });
  });

  it('runs for the whole scene when no limit is given', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, backgroundEveryFrames: 2,
    });
    assert.equal(updated.scene.backgroundMotion.everyFrames, 2);
    assert.equal(updated.scene.backgroundMotion.times, undefined);
  });

  it('rejects an interval below one frame', async () => {
    const project = await makeProject(client);
    await rejectsSchema(client, 'update_scene', {
      projectId: project.projectId, sceneId: project.scenes[0].sceneId,
      backgroundEveryFrames: 0,
    });
  });

  it('survives the store round trip alongside everything else', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId,
      style: 'none', exit: 'none', staggerFrames: 2, staggerOrder: 'reverse',
      backgroundEveryFrames: 4, backgroundTimes: 8,
    });
    await ok(client, 'create_scene', { projectId: project.projectId, text: 'churn' });

    const raw = await ok(client, 'get_flarent_json', { projectId: project.projectId });
    const stored = raw.document.scenes[0];
    assert.equal(stored.animation, 'NONE');
    assert.equal(stored.exit, 'NONE');
    assert.deepEqual(stored.stagger, { type: 'WORD', delayFrames: 2, order: 'REVERSE' });
    assert.deepEqual(stored.backgroundMotion, { mode: 'ALTERNATE', everyFrames: 4, times: 8 });
  });
});

describe('phase two is discoverable', () => {
  it('describe_capabilities names the new behaviours', async () => {
    const capabilities = await ok(client, 'describe_capabilities');
    assert.match(capabilities.supported.textExits, /hard cut/i);
    assert.match(capabilities.supported.wordStagger, /frames apart/i);
    assert.match(capabilities.supported.backgroundMotion, /alternate/i);
  });
});
