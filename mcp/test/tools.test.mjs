/**
 * Project, scene, content, typography, motion and timing tools.
 *
 * The emphasis throughout is on the things that would actually break a client:
 * ids that must round-trip, destructive operations that must refuse without
 * confirmation, and enum validation that must reject rather than silently
 * substitute.
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

/* ------------------------------------------------------------------ schemas */

describe('tool schemas', () => {
  it('exposes every tool with a description and an input schema', async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 50, `expected a full toolset, got ${tools.length}`);
    for (const tool of tools) {
      assert.ok(tool.description?.length > 20, `${tool.name} needs a real description`);
      assert.ok(tool.inputSchema, `${tool.name} has no input schema`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  it('enumerates legal values rather than accepting free strings', async () => {
    const { tools } = await client.listTools();
    const applyStyle = tools.find((tool) => tool.name === 'apply_typography_style');
    assert.ok(Array.isArray(applyStyle.inputSchema.properties.style.enum));

    const addText = tools.find((tool) => tool.name === 'add_text');
    assert.deepEqual(
      addText.inputSchema.properties.role.enum,
      ['primary', 'secondary', 'emphasis', 'support'],
    );
  });

  it('marks destructive tools with an annotation', async () => {
    const { tools } = await client.listTools();
    for (const name of ['delete_project', 'delete_scene', 'remove_element', 'remove_audio']) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.equal(tool.annotations?.destructiveHint, true, `${name} should be marked destructive`);
    }
  });
});

/* ----------------------------------------------------------------- projects */

describe('project tools', () => {
  it('creates, reads, updates and lists a project', async () => {
    const created = await makeProject(client, { title: 'Discipline' });
    assert.match(created.projectId, /^prj_[0-9a-f]{12}$/);
    assert.equal(created.sceneCount, 3);
    assert.equal(created.title, 'Discipline');
    assert.equal(created.format, 'portrait');
    assert.equal(created.width, 1080);

    const fetched = await ok(client, 'get_project', { projectId: created.projectId });
    assert.equal(fetched.project.projectId, created.projectId);

    const updated = await ok(client, 'update_project', {
      projectId: created.projectId,
      title: 'Renamed',
      format: 'landscape',
    });
    assert.equal(updated.project.title, 'Renamed');
    assert.equal(updated.project.width, 1920);

    const listed = await ok(client, 'list_projects');
    assert.ok(listed.projects.some((row) => row.projectId === created.projectId));
  });

  it('seeds a scene when none is supplied, because zero scenes cannot render', async () => {
    const created = await ok(client, 'create_project', { title: 'Empty' });
    assert.equal(created.project.sceneCount, 1);
  });

  it('rejects a malformed project id at the schema, before any handler runs', async () => {
    // The id pattern is enforced in the tool schema, so a traversal attempt or a
    // wrong-shaped id never reaches the store at all.
    await rejectsSchema(client, 'get_project', { projectId: 'prj_notavalidid' });
    await rejectsSchema(client, 'get_project', { projectId: '../../etc/passwd' });
    await rejectsSchema(client, 'get_project', { projectId: 'prj_../../../secrets' });
  });

  it('reports NOT_FOUND for a well-formed id that does not exist', async () => {
    const error = await fails(
      client, 'get_project', { projectId: 'prj_000000000000' }, 'NOT_FOUND',
    );
    assert.equal(error.retryable, false);
  });

  it('duplicates a project without linking the copy to the original', async () => {
    const source = await makeProject(client);
    const copy = await ok(client, 'duplicate_project', { projectId: source.projectId });
    assert.notEqual(copy.project.projectId, source.projectId);

    await ok(client, 'update_project', { projectId: copy.project.projectId, title: 'Changed' });
    const original = await ok(client, 'get_project', { projectId: source.projectId });
    assert.notEqual(original.project.title, 'Changed');
  });

  it('refuses to delete without explicit confirmation', async () => {
    const project = await makeProject(client);
    await fails(client, 'delete_project', { projectId: project.projectId }, 'CONFIRMATION_REQUIRED');

    // Still there.
    await ok(client, 'get_project', { projectId: project.projectId });

    await ok(client, 'delete_project', { projectId: project.projectId, confirm: true });
    await fails(client, 'get_project', { projectId: project.projectId }, 'NOT_FOUND');
  });
});

/* ------------------------------------------------------------------- scenes */

describe('scene tools', () => {
  it('creates, updates and inspects a scene', async () => {
    const project = await makeProject(client);
    const created = await ok(client, 'create_scene', {
      projectId: project.projectId,
      text: 'new one',
      duration: 0.9,
      style: 'massive',
      background: 'black',
    });
    assert.equal(created.project.sceneCount, 4);

    const sceneId = created.scene.sceneId;
    const updated = await ok(client, 'update_scene', {
      projectId: project.projectId, sceneId, text: 'edited', style: 'slide',
    });
    assert.equal(updated.scene.text, 'edited');
    assert.equal(updated.scene.style, 'slide');
  });

  it('inserts at an index', async () => {
    const project = await makeProject(client);
    const created = await ok(client, 'create_scene', {
      projectId: project.projectId, text: 'first now', index: 0,
    });
    assert.equal(created.project.scenes[0].sceneId, created.scene.sceneId);
  });

  it('reorders only when given every scene exactly once', async () => {
    const project = await makeProject(client);
    const ids = project.scenes.map((scene) => scene.sceneId);

    await fails(
      client, 'reorder_scenes',
      { projectId: project.projectId, sceneIds: [ids[0]] },
      'VALIDATION_ERROR',
    );

    const reordered = await ok(client, 'reorder_scenes', {
      projectId: project.projectId, sceneIds: [ids[2], ids[0], ids[1]],
    });
    assert.deepEqual(reordered.project.scenes.map((s) => s.sceneId), [ids[2], ids[0], ids[1]]);
  });

  it('duplicates a scene with fresh ids', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'a line' });

    const copy = await ok(client, 'duplicate_scene', { projectId: project.projectId, sceneId });
    assert.notEqual(copy.sceneId, sceneId);

    const original = await ok(client, 'inspect_scene', { projectId: project.projectId, sceneId });
    const duplicate = await ok(client, 'inspect_scene', {
      projectId: project.projectId, sceneId: copy.sceneId,
    });
    // Same content, no shared element id.
    assert.equal(original.scene.elements.length, duplicate.scene.elements.length);
    for (const element of duplicate.scene.elements) {
      assert.ok(!original.scene.elements.some((other) => other.elementId === element.elementId));
    }
  });

  it('will not delete the last remaining scene', async () => {
    const project = await ok(client, 'create_project', { title: 'One scene' });
    const sceneId = project.project.scenes[0].sceneId;
    await fails(
      client, 'delete_scene',
      { projectId: project.project.projectId, sceneId, confirm: true },
      'VALIDATION_ERROR',
    );
  });

  it('requires confirmation to delete a scene', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[1].sceneId;
    await fails(
      client, 'delete_scene',
      { projectId: project.projectId, sceneId },
      'CONFIRMATION_REQUIRED',
    );
    const deleted = await ok(client, 'delete_scene', {
      projectId: project.projectId, sceneId, confirm: true,
    });
    assert.equal(deleted.project.sceneCount, 2);
  });
});

/* ------------------------------------------------------------------ content */

describe('content tools', () => {
  it('adds text and keeps the scene text in step with its elements', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    const first = await ok(client, 'add_text', {
      projectId: project.projectId, sceneId, text: 'discipline', role: 'primary',
    });
    await ok(client, 'add_text', {
      projectId: project.projectId, sceneId, text: 'beats motivation', role: 'emphasis',
    });

    const scene = await ok(client, 'inspect_scene', { projectId: project.projectId, sceneId });
    assert.equal(scene.scene.elements.length, 2);
    // `scene.text` must reflect the elements, or the reel reads differently
    // from how it renders.
    assert.equal(scene.scene.text, 'discipline\nbeats motivation');
    assert.ok(first.elementId);
  });

  it('adds and updates a graphic object', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    const added = await ok(client, 'add_shape', {
      projectId: project.projectId, sceneId, kind: 'button', label: 'Get started',
    });
    assert.ok(added.objectId);

    const updated = await ok(client, 'update_shape', {
      projectId: project.projectId, sceneId, objectId: added.objectId,
      x: 0.2, width: 0.6, fill: '#4ADE6A',
    });
    const object = updated.scene.objects.find((o) => o.objectId === added.objectId);
    assert.equal(object.box.x, 0.2);
    assert.equal(object.box.width, 0.6);
  });

  it('rejects a label on an object kind that has none', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const added = await ok(client, 'add_shape', {
      projectId: project.projectId, sceneId, kind: 'shape', shape: 'circle',
    });
    await fails(
      client, 'update_shape',
      { projectId: project.projectId, sceneId, objectId: added.objectId, label: 'nope' },
      'VALIDATION_ERROR',
    );
  });

  it('removes either a text element or an object by id', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;

    const text = await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'one' });
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'two' });
    const shape = await ok(client, 'add_shape', { projectId: project.projectId, sceneId, kind: 'card' });

    await fails(
      client, 'remove_element',
      { projectId: project.projectId, sceneId, elementId: text.elementId },
      'CONFIRMATION_REQUIRED',
    );

    const afterText = await ok(client, 'remove_element', {
      projectId: project.projectId, sceneId, elementId: text.elementId, confirm: true,
    });
    assert.equal(afterText.scene.elements.length, 1);

    const afterShape = await ok(client, 'remove_element', {
      projectId: project.projectId, sceneId, elementId: shape.objectId, confirm: true,
    });
    assert.equal(afterShape.scene.objects.length, 0);
  });

  it('reports the available ids when one is not found', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'x' });

    const error = await fails(
      client, 'remove_element',
      { projectId: project.projectId, sceneId, elementId: 'el-nope', confirm: true },
      'NOT_FOUND',
    );
    assert.ok(Array.isArray(error.details.availableElementIds));
  });
});

/* --------------------------------------------------------------- typography */

describe('typography tools', () => {
  it('applies a named style to one element', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const added = await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'hero line' });

    const styled = await ok(client, 'apply_typography_style', {
      projectId: project.projectId, sceneId, elementId: added.elementId, style: 'hero',
    });
    const element = styled.scene.elements.find((el) => el.elementId === added.elementId);
    assert.equal(element.role, 'primary');
    assert.equal(element.size, 'oversized');
    assert.equal(element.case, 'upper');
  });

  it('applies a style to every element when no id is given', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'one' });
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'two' });

    const styled = await ok(client, 'apply_typography_style', {
      projectId: project.projectId, sceneId, style: 'caption',
    });
    assert.ok(styled.scene.elements.every((el) => el.size === 'small'));
  });

  it('explains that per-property font control does not exist', async () => {
    const error = await fails(
      client, 'set_font_property', { property: 'fontWeight' }, 'UNSUPPORTED_CAPABILITY',
    );
    assert.ok(error.details.useInstead.includes('apply_typography_style'));
  });

  it('sets per-word colours', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const result = await ok(client, 'set_word_colors', {
      projectId: project.projectId, sceneId, colors: { discipline: '#4ADE6A' },
    });
    assert.equal(result.scene.wordColors.discipline, '#4ADE6A');

    await rejectsSchema(client, 'set_word_colors', {
      projectId: project.projectId, sceneId, colors: { x: 'not-a-colour' },
    });
  });

  it('refuses to style a scene that has no elements', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'apply_typography_style',
      { projectId: project.projectId, sceneId: project.scenes[0].sceneId, style: 'hero' },
      'VALIDATION_ERROR',
    );
  });
});

/* ------------------------------------------------------------------- motion */

describe('motion tools', () => {
  it('applies a motion style to a scene and its objects', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const shape = await ok(client, 'add_shape', { projectId: project.projectId, sceneId, kind: 'card' });

    const styled = await ok(client, 'apply_motion_style', {
      projectId: project.projectId, sceneId, style: 'aggressive',
    });
    assert.equal(styled.scene.style, 'punch');
    const object = styled.scene.objects.find((o) => o.objectId === shape.objectId);
    assert.equal(object.enter, 'pop-in');
    assert.equal(object.emphasis, 'shake');
  });

  it('routes animate_element to the right model for text and objects', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const text = await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'word' });
    const shape = await ok(client, 'add_shape', { projectId: project.projectId, sceneId, kind: 'icon' });

    const textResult = await ok(client, 'animate_element', {
      projectId: project.projectId, sceneId, elementId: text.elementId, animation: 'massive',
    });
    assert.equal(
      textResult.scene.elements.find((el) => el.elementId === text.elementId).animation,
      'massive',
    );

    const objectResult = await ok(client, 'animate_element', {
      projectId: project.projectId, sceneId, elementId: shape.objectId,
      entrance: 'draw-in', speed: 'slow',
    });
    const object = objectResult.scene.objects.find((o) => o.objectId === shape.objectId);
    assert.equal(object.enter, 'draw-in');
    assert.equal(object.speed, 'slow');
  });

  it('explains the mismatch when an object model is used on text', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const text = await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'word' });

    await fails(
      client, 'animate_element',
      { projectId: project.projectId, sceneId, elementId: text.elementId, entrance: 'pop-in' },
      'VALIDATION_ERROR',
    );
  });

  it('rejects a motion name the engine does not have', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const shape = await ok(client, 'add_shape', { projectId: project.projectId, sceneId, kind: 'card' });
    await rejectsSchema(client, 'set_entrance', {
      projectId: project.projectId, sceneId, objectId: shape.objectId, enter: 'explode',
    });
  });

  it('reports the real vocabulary', async () => {
    const vocabulary = await ok(client, 'list_motion_vocabulary');
    assert.ok(vocabulary.objectEntrances.includes('float-in'));
    assert.ok(vocabulary.objectEmphases.includes('glow'));
    assert.match(vocabulary.note, /no keyframes/i);
  });
});

/* ------------------------------------------------------------------- timing */

describe('timing tools', () => {
  it('sets one scene duration and shifts the rest', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const result = await ok(client, 'set_scene_duration', {
      projectId: project.projectId, sceneId, duration: 2,
    });
    assert.equal(result.project.scenes[0].duration, 2);
    assert.equal(result.project.scenes[1].start, 2);
  });

  it('scales the whole project by a factor', async () => {
    const project = await makeProject(client);
    const before = project.duration;
    const scaled = await ok(client, 'scale_timing', { projectId: project.projectId, factor: 0.5 });
    assert.ok(
      Math.abs(scaled.project.duration - before / 2) < 0.1,
      `expected about ${before / 2}, got ${scaled.project.duration}`,
    );
  });

  it('fits the video to a target duration', async () => {
    const project = await makeProject(client);
    const fitted = await ok(client, 'scale_timing', {
      projectId: project.projectId, targetDuration: 7,
    });
    assert.ok(
      Math.abs(fitted.project.duration - 7) < 0.15,
      `expected about 7s, got ${fitted.project.duration}`,
    );
  });

  it('ramps progressively across selected scenes', async () => {
    const project = await makeProject(client);
    const ids = project.scenes.map((scene) => scene.sceneId);
    const ramped = await ok(client, 'scale_timing', {
      projectId: project.projectId, factor: 0.5, sceneIds: ids, progressive: true,
    });
    // First keeps its length, last takes the full factor.
    assert.ok(Math.abs(ramped.project.scenes[0].duration - project.scenes[0].duration) < 0.05);
    assert.ok(ramped.project.scenes[2].duration < project.scenes[2].duration * 0.75);
  });

  it('requires exactly one of factor or targetDuration', async () => {
    const project = await makeProject(client);
    await fails(client, 'scale_timing', { projectId: project.projectId }, 'VALIDATION_ERROR');
    await fails(
      client, 'scale_timing',
      { projectId: project.projectId, factor: 2, targetDuration: 5 },
      'VALIDATION_ERROR',
    );
  });

  it('reports clamping instead of silently ignoring it', async () => {
    const project = await makeProject(client);
    /*
     * V8 lowered the scene floor from 0.15s to one frame, so scaling now has to
     * go much further before anything clamps: 0.05 x 0.6s is 0.03s, just under
     * the 1/30 floor. The assertion is on the *behaviour* — that clamping is
     * reported rather than silently applied — not on the old constant.
     */
    const scaled = await ok(client, 'scale_timing', { projectId: project.projectId, factor: 0.05 });
    assert.ok(scaled.clamped?.length > 0, 'expected clamping to be reported');
    assert.ok(
      // `applied` is rounded to three places for readability, so compare loosely.
      scaled.clamped.every((row) => Math.abs(row.applied - 1 / 30) < 0.001),
      `a clamped scene should land on the one-frame floor, got ${JSON.stringify(scaled.clamped)}`,
    );

    /*
     * Nothing may collapse below a single frame.
     *
     * The reported durations are rounded to three places for readability, so
     * one frame (0.0333…s) comes back as 0.033 — a hair under the exact value.
     * The tolerance is for that rounding, not for the invariant: half a frame
     * would be 0.017 and would fail this comfortably.
     */
    assert.ok(
      scaled.project.scenes.every((scene) => scene.duration >= 1 / 30 - 0.001),
      `a scene fell below one frame: ${scaled.project.scenes.map((s) => s.duration)}`,
    );
  });

  it('shifts content inside a scene without moving the scene', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'a', delay: 0.1 });

    const shifted = await ok(client, 'shift_timing', {
      projectId: project.projectId, sceneId, seconds: 0.25,
    });
    assert.equal(shifted.scene.elements[0].delay, 0.35);
    assert.equal(shifted.scene.duration, project.scenes[0].duration);
  });

  it('never shifts content before zero', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    await ok(client, 'add_text', { projectId: project.projectId, sceneId, text: 'a', delay: 0.1 });
    const shifted = await ok(client, 'shift_timing', {
      projectId: project.projectId, sceneId, seconds: -5,
    });
    // A zero delay is dropped by the serialiser (`...(element.delay ? ... : {})`),
    // so "no delay" reads back as an absent field rather than as 0. Either way
    // the element must not have been pushed negative.
    assert.ok(!shifted.scene.elements[0].delay, 'delay should be absent or zero');
  });

  it('rejects a duration outside the engine limits at the schema', async () => {
    const project = await makeProject(client);
    await rejectsSchema(client, 'set_scene_duration', {
      projectId: project.projectId, sceneId: project.scenes[0].sceneId, duration: 99,
    });
  });
});

/* -------------------------------------------------------------- idempotency */

describe('idempotency', () => {
  it('replays a create instead of making a second project', async () => {
    const key = `test-key-${Date.now()}`;
    const first = await ok(client, 'create_project', { title: 'Once', idempotencyKey: key });
    const second = await ok(client, 'create_project', { title: 'Once', idempotencyKey: key });

    assert.equal(second.project.projectId, first.project.projectId);
    assert.equal(second.replayed, true);
  });

  it('scopes keys by tool, so the same key elsewhere is a different record', async () => {
    const key = `shared-key-${Date.now()}`;
    const project = await ok(client, 'create_project', { title: 'A', idempotencyKey: key });
    const scene = await ok(client, 'create_scene', {
      projectId: project.project.projectId, text: 'new', idempotencyKey: key,
    });
    assert.ok(scene.scene.sceneId);
    assert.notEqual(scene.replayed, true);
  });

  it('creates two projects without a key', async () => {
    const first = await ok(client, 'create_project', { title: 'Twice' });
    const second = await ok(client, 'create_project', { title: 'Twice' });
    assert.notEqual(first.project.projectId, second.project.projectId);
  });
});

/* --------------------------------------------------------------- inspection */

describe('inspection tools', () => {
  it('returns a compact project summary rather than the raw document', async () => {
    const project = await makeProject(client);
    const inspected = await ok(client, 'inspect_project', { projectId: project.projectId });

    assert.equal(inspected.project.sceneCount, 3);
    assert.ok(inspected.project.scenes[0].sceneId);
    // A summary row must not carry the full element list.
    assert.equal(inspected.project.scenes[0].elements, undefined);
    assert.equal(inspected.project.palette.nameIsDerived, true);
  });

  it('describes what the engine cannot do', async () => {
    const capabilities = await ok(client, 'describe_capabilities');
    assert.match(capabilities.notSupported.keyframes, /no keyframe model/i);
    assert.match(capabilities.notSupported.video, /cannot contain video/i);
  });

  it('exposes the raw Flarent document for import into the editor', async () => {
    const project = await makeProject(client);
    const raw = await ok(client, 'get_flarent_json', { projectId: project.projectId });
    assert.equal(raw.document.scenes.length, 3);
    assert.ok(raw.document.width);
    assert.ok(raw.document.fps);
  });
});
