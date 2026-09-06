/**
 * Phase 3 — bulk operations, timeline arrays, contact sheets and phrase build.
 *
 * The theme running through these is *atomicity*: a bulk tool that half-applies
 * is worse than one that refuses, because the caller cannot tell what happened
 * and cannot safely retry. Several tests here deliberately make one entry in a
 * batch invalid and then assert that **nothing** changed.
 */

import './env.mjs';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { connect, fails, makeProject, ok, rejectsSchema } from './helpers.mjs';
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

describe('bulk scene updates', () => {
  it('applies different values to several scenes in one call', async () => {
    const project = await makeProject(client);
    const [a, b, c] = project.scenes.map((scene) => scene.sceneId);

    const result = await ok(client, 'update_scenes', {
      projectId: project.projectId,
      updates: [
        { sceneId: a, durationInFrames: 7, style: 'none' },
        { sceneId: b, durationInFrames: 8, background: 'black' },
        { sceneId: c, durationInFrames: 6, staggerFrames: 2 },
      ],
    });

    assert.equal(result.updated, 3);
    const frames = result.project.scenes.map((scene) => scene.frames);
    assert.deepEqual(frames, [7, 8, 6]);
    assert.equal(result.project.scenes[0].style, 'none');
    assert.equal(result.project.scenes[1].background, 'black');
  });

  it('changes nothing when any entry in the batch is invalid', async () => {
    const project = await makeProject(client);
    const [a, b] = project.scenes.map((scene) => scene.sceneId);
    const before = await ok(client, 'inspect_project', { projectId: project.projectId });

    // The first entry is perfectly valid; the second names a scene that is not
    // in this project. Neither may be applied.
    await fails(
      client, 'update_scenes',
      {
        projectId: project.projectId,
        updates: [
          { sceneId: a, durationInFrames: 7 },
          { sceneId: 'scene-does-not-exist', durationInFrames: 9 },
        ],
      },
      'NOT_FOUND',
    );

    const after = await ok(client, 'inspect_project', { projectId: project.projectId });
    assert.deepEqual(
      after.project.scenes.map((scene) => scene.frames),
      before.project.scenes.map((scene) => scene.frames),
      'a failed batch must leave every scene untouched',
    );
    assert.ok(b);
  });

  it('refuses a batch that names the same scene twice', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const error = await fails(
      client, 'update_scenes',
      {
        projectId: project.projectId,
        updates: [
          { sceneId, durationInFrames: 7 },
          { sceneId, durationInFrames: 9 },
        ],
      },
      'VALIDATION_ERROR',
    );
    assert.match(error.message, /more than once/i);
  });

  it('refuses an entry that changes nothing', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'update_scenes',
      { projectId: project.projectId, updates: [{ sceneId: project.scenes[0].sceneId }] },
      'VALIDATION_ERROR',
    );
  });

  it('replays rather than re-applying for a repeated idempotency key', async () => {
    const project = await makeProject(client);
    const sceneId = project.scenes[0].sceneId;
    const key = `bulk-${Date.now()}`;
    const args = {
      projectId: project.projectId,
      updates: [{ sceneId, durationInFrames: 7 }],
      idempotencyKey: key,
    };
    await ok(client, 'update_scenes', args);
    const second = await ok(client, 'update_scenes', args);
    assert.equal(second.replayed, true);
  });
});

describe('applying one change to many scenes', () => {
  it('applies to an index range, inclusive at both ends', async () => {
    const project = await makeProject(client);
    const result = await ok(client, 'apply_to_scenes', {
      projectId: project.projectId, fromIndex: 0, toIndex: 1, background: 'black',
    });
    assert.equal(result.updated, 2);
    const backgrounds = result.project.scenes.map((scene) => scene.background);
    assert.deepEqual(backgrounds.slice(0, 2), ['black', 'black']);
    assert.notEqual(backgrounds[2], 'black', 'the third scene was outside the range');
  });

  it('applies to explicit ids, and to everything when nothing is selected', async () => {
    const project = await makeProject(client);
    const [, b] = project.scenes.map((scene) => scene.sceneId);

    const one = await ok(client, 'apply_to_scenes', {
      projectId: project.projectId, sceneIds: [b], style: 'none',
    });
    assert.deepEqual(one.sceneIds, [b]);

    const all = await ok(client, 'apply_to_scenes', {
      projectId: project.projectId, enterFrames: 2,
    });
    assert.equal(all.updated, 3);
    assert.ok(all.project.scenes.every((scene) => scene.frames > 0));
  });

  it('refuses two selectors at once, and an empty patch', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'apply_to_scenes',
      { projectId: project.projectId, sceneIds: [project.scenes[0].sceneId], fromIndex: 0, style: 'none' },
      'VALIDATION_ERROR',
    );
    await fails(
      client, 'apply_to_scenes', { projectId: project.projectId }, 'VALIDATION_ERROR',
    );
  });

  it('reports an out-of-range index rather than silently doing nothing', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'apply_to_scenes',
      { projectId: project.projectId, fromIndex: 99, style: 'none' },
      'VALIDATION_ERROR',
    );
  });
});

describe('setting the whole timeline from an array', () => {
  it('applies a cut list in scene order', async () => {
    const project = await makeProject(client);
    const result = await ok(client, 'set_timeline_durations', {
      projectId: project.projectId, framesPerScene: [7, 8, 6],
    });
    assert.deepEqual(result.scenes.map((scene) => scene.frames), [7, 8, 6]);
    assert.equal(result.frames, 21);
    // Starts are cumulative and derived, never stored.
    assert.deepEqual(result.scenes.map((scene) => scene.frames), [7, 8, 6]);
  });

  it('accepts seconds as well as frames', async () => {
    const project = await makeProject(client);
    const result = await ok(client, 'set_timeline_durations', {
      projectId: project.projectId, secondsPerScene: [1, 0.5, 1.5],
    });
    assert.equal(result.frames, 30 + 15 + 45);
  });

  it('refuses a list that does not match the scene count', async () => {
    const project = await makeProject(client);
    const error = await fails(
      client, 'set_timeline_durations',
      { projectId: project.projectId, framesPerScene: [7, 8] },
      'VALIDATION_ERROR',
    );
    assert.match(error.message, /Expected 3 duration/);

    // Unchanged — a mismatched list must not apply its first N entries.
    const after = await ok(client, 'inspect_project', { projectId: project.projectId });
    assert.notEqual(after.project.scenes[0].frames, 7);
  });

  it('applies a shorter list to a run when fromIndex is given', async () => {
    const project = await makeProject(client);
    const result = await ok(client, 'set_timeline_durations', {
      projectId: project.projectId, framesPerScene: [9, 9], fromIndex: 1,
    });
    assert.deepEqual(result.scenes.slice(1).map((scene) => scene.frames), [9, 9]);
  });

  it('requires exactly one unit', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'set_timeline_durations', { projectId: project.projectId }, 'VALIDATION_ERROR',
    );
    await fails(
      client, 'set_timeline_durations',
      { projectId: project.projectId, framesPerScene: [7, 8, 6], secondsPerScene: [1, 1, 1] },
      'VALIDATION_ERROR',
    );
  });
});

describe('phrase build', () => {
  it('turns a sentence into an accelerating run of ordinary scenes', async () => {
    const project = await ok(client, 'create_project', { title: 'Build' });
    const projectId = project.project.projectId;

    const built = await ok(client, 'phrase_build', {
      projectId,
      sentence: 'consistency beats motivation every single day',
      totalFrames: 90,
      replace: true,
    });

    assert.ok(built.phrases.length >= 2, `expected several phrases, got ${built.phrases}`);
    assert.equal(built.finalWord, 'day');
    // The budget is honoured exactly.
    assert.equal(built.framesPerPhrase.reduce((a, b) => a + b, 0), 90);
    // Accelerating: each card is no longer than the one before it.
    for (let i = 1; i < built.framesPerPhrase.length; i++) {
      assert.ok(
        built.framesPerPhrase[i] <= built.framesPerPhrase[i - 1],
        `accelerate should not lengthen: ${built.framesPerPhrase}`,
      );
    }
  });

  it('produces scenes that are editable like any other', async () => {
    const project = await ok(client, 'create_project', { title: 'Editable' });
    const projectId = project.project.projectId;
    const built = await ok(client, 'phrase_build', {
      projectId, sentence: 'one two three four five six', replace: true,
    });

    // The proof that this is a constructor and not a template: an ordinary
    // update_scene changes a generated scene, and it sticks.
    const target = built.created[1].sceneId;
    const edited = await ok(client, 'update_scene', {
      projectId, sceneId: target, text: 'rewritten', style: 'slide',
    });
    assert.equal(edited.scene.text, 'rewritten');
    assert.equal(edited.scene.style, 'slide');

    // And the document has no phrase-build marker anywhere.
    const raw = await ok(client, 'get_flarent_json', { projectId });
    assert.equal(JSON.stringify(raw.document).includes('phraseBuild'), false);
    assert.equal(raw.document.scenes[1].text, 'rewritten');
  });

  it('honours explicit breaks and an explicit cut list', async () => {
    const project = await ok(client, 'create_project', { title: 'Explicit' });
    const projectId = project.project.projectId;
    const built = await ok(client, 'phrase_build', {
      projectId,
      sentence: 'ignored when phrases are given',
      phrases: ['first phrase', 'second phrase', 'third'],
      framesPerPhrase: [10, 12, 14],
      finalWordEmphasis: false,
      replace: true,
    });
    assert.deepEqual(built.phrases, ['first phrase', 'second phrase', 'third']);
    assert.equal(built.finalWord, null);
    assert.deepEqual(built.created.map((scene) => scene.frames), [10, 12, 14]);
  });

  it('appends by default and replaces on request', async () => {
    const project = await makeProject(client);
    const appended = await ok(client, 'phrase_build', {
      projectId: project.projectId, sentence: 'added on the end', totalFrames: 30,
    });
    assert.ok(
      appended.project.sceneCount > 3,
      'the build should have been appended to the existing scenes',
    );

    const replaced = await ok(client, 'phrase_build', {
      projectId: project.projectId, sentence: 'only this now', totalFrames: 30, replace: true,
    });
    assert.equal(replaced.project.sceneCount, replaced.created.length);
  });

  it('supports the other pacing curves', async () => {
    const project = await ok(client, 'create_project', { title: 'Pacing' });
    const projectId = project.project.projectId;

    const even = await ok(client, 'phrase_build', {
      projectId, sentence: 'a b c d e f g h i', pacing: 'even', totalFrames: 90,
      finalWordEmphasis: false, replace: true,
    });
    const spread = Math.max(...even.framesPerPhrase) - Math.min(...even.framesPerPhrase);
    assert.ok(spread <= 1, `even pacing should be flat, got ${even.framesPerPhrase}`);

    const slower = await ok(client, 'phrase_build', {
      projectId, sentence: 'a b c d e f g h i', pacing: 'decelerate', totalFrames: 90,
      finalWordEmphasis: false, replace: true,
    });
    assert.ok(
      slower.framesPerPhrase[slower.framesPerPhrase.length - 1] >= slower.framesPerPhrase[0],
      `decelerate should lengthen: ${slower.framesPerPhrase}`,
    );
  });

  it('refuses a sentence that yields no phrases', async () => {
    const project = await makeProject(client);
    await rejectsSchema(client, 'phrase_build', {
      projectId: project.projectId, sentence: '',
    });
  });
});

describe('contact sheet', () => {
  it('tiles one cell per scene and maps each back to its scene', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const result = await ok(client, 'render_contact_sheet', { projectId: project.projectId });

    assert.equal(result.cellCount, 3, 'one cell per scene by default');
    assert.equal(result.cells.length, 3);
    for (const [i, cell] of result.cells.entries()) {
      assert.equal(cell.sceneId, project.scenes[i].sceneId, 'cells must map back to scenes');
      assert.ok(cell.width > 0 && cell.height > 0);
      assert.ok(typeof cell.atSecond === 'number');
    }

    const image = result._result.content.find((block) => block.type === 'image');
    assert.ok(image, 'the sheet must come back as an image');
    const bytes = Buffer.from(image.data, 'base64');
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'expected a PNG');
    assert.ok(bytes.length > 2000, `a real sheet should not be ${bytes.length} bytes`);
  });

  it('takes a scene range and an explicit grid width', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const result = await ok(client, 'render_contact_sheet', {
      projectId: project.projectId, fromIndex: 0, toIndex: 1, columns: 1,
    });
    assert.equal(result.cellCount, 2);
    assert.equal(result.columns, 1);
    assert.equal(result.rows, 2);
    // One column means the cells stack vertically.
    assert.equal(result.cells[0].x, result.cells[1].x);
    assert.ok(result.cells[1].y > result.cells[0].y);
  });

  it('accepts exact frames and labels them with the scene they fall in', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const project = await makeProject(client);
    const result = await ok(client, 'render_contact_sheet', {
      projectId: project.projectId, frames: [5, 40],
    });
    assert.equal(result.cellCount, 2);
    assert.equal(result.cells[0].frame, 5);
    assert.ok(result.cells[0].sceneId, 'a frame inside a scene should name it');
  });

  it('rejects an unknown scene and an impossible range', async () => {
    const project = await makeProject(client);
    await fails(
      client, 'render_contact_sheet',
      { projectId: project.projectId, sceneIds: ['nope'] },
      'VALIDATION_ERROR',
    );
    await fails(
      client, 'render_contact_sheet',
      { projectId: project.projectId, fromIndex: 2, toIndex: 1 },
      'VALIDATION_ERROR',
    );
  });
});

describe('phase three end to end', () => {
  it('builds, re-times in bulk and storyboards in four calls', async (t) => {
    const project = await ok(client, 'create_project', { title: 'Phase 3 flow' });
    const projectId = project.project.projectId;

    // 1 — one call for the whole build.
    const built = await ok(client, 'phrase_build', {
      projectId,
      sentence: 'discipline beats motivation every single day',
      totalFrames: 120,
      staggerFrames: 2,
      enterFrames: 2,
      replace: true,
    });
    const ids = built.created.map((scene) => scene.sceneId);

    // 2 — one call for the whole cut list.
    const retimed = await ok(client, 'set_timeline_durations', {
      projectId, framesPerScene: ids.map((_id, i) => 20 - i * 3),
    });
    assert.equal(retimed.scenes.length, ids.length);

    // 3 — one call to restyle every card.
    const styled = await ok(client, 'apply_to_scenes', {
      projectId, background: 'black', fitWidth: 0.86,
    });
    assert.equal(styled.updated, ids.length);

    // 4 — one look at the whole thing.
    if (!serverUp) return t.skip('render server not running — skipping the storyboard');
    const sheet = await ok(client, 'render_contact_sheet', { projectId });
    assert.equal(sheet.cellCount, ids.length);
  });
});
