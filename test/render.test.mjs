/**
 * V8 capabilities, verified by rendering actual frames.
 *
 * The schema tests prove a field survives the round trip. They cannot prove the
 * pixels do what the field promises — and for `animation: "none"` the promise
 * *is* a pixel property: "this does not move". So these render real frames
 * through the real renderer and compare them.
 *
 * Every assertion here has a control. Proving that two frames of a static scene
 * are identical means nothing unless the same comparison can tell that two
 * frames of an animated scene differ — otherwise a broken renderer that emitted
 * the same blank frame every time would pass. Each test that asserts sameness is
 * paired with one that asserts difference.
 *
 * Skips itself when the render server is not running (`npm run dev`).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { loadEngine } from '../mcp/lib/engine.mjs';
import { health, renderStill } from '../mcp/lib/render-client.mjs';
import { inkColumns, pixelAt, readPng } from './png.mjs';

let engine;
let serverUp = false;
const rendered = [];

before(async () => {
  engine = await loadEngine();
  try {
    await health();
    serverUp = true;
  } catch {
    serverUp = false;
  }
});

after(() => {
  // The still endpoint writes into `out/`; these are test artefacts.
  for (const file of rendered) fs.rmSync(file, { force: true });
});

/** Render one frame and return its path plus a hash of the bytes. */
const still = async (scenes, frame, options = {}) => {
  const result = await renderStill({
    scenes,
    palette: options.palette ?? 'forest',
    fields: options.fields ?? {},
    ...(options.ink ? { ink: options.ink } : {}),
    ...(options.accent ? { accent: options.accent } : {}),
    frame,
  });
  rendered.push(result.path);
  const bytes = fs.readFileSync(result.path);
  return {
    path: result.path,
    hash: createHash('sha1').update(bytes).digest('hex'),
    width: result.width,
    height: result.height,
    png: readPng(result.path),
  };
};

const scene = (overrides) =>
  engine.blankScene({ text: 'discipline', duration: 1.5, background: 'cream', ...overrides });

describe('animation: none renders as a genuine hold', () => {
  it('produces byte-identical frames across the whole scene', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = [scene({ style: 'none' })];
    // Frame 1 is just after the cut; 22 and 44 are deep into the scene. If any
    // channel moved — position, scale, opacity, blur — these would differ.
    const [a, b, c] = await Promise.all([
      still(scenes, 1), still(scenes, 22), still(scenes, 44),
    ]);

    assert.equal(a.hash, b.hash, 'frame 1 and frame 22 must be identical');
    assert.equal(b.hash, c.hash, 'frame 22 and frame 44 must be identical');
  });

  it('is fully opaque from its first frame — no fade-in at all', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = [scene({ style: 'none' })];
    const first = await still(scenes, 0);
    const later = await still(scenes, 30);
    /*
     * Frame 0 is the real test. Every other style starts at zero opacity, which
     * is why "frame 0 of every reel is blank" is a documented property of the
     * engine. A held card must break that rule — it is *there* on the cut.
     */
    assert.equal(first.hash, later.hash, 'frame 0 must already be the final image');
  });

  it('CONTROL: an animated scene does change between the same frames', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = [scene({ style: 'punch' })];
    const [a, b] = await Promise.all([still(scenes, 1), still(scenes, 22)]);
    assert.notEqual(
      a.hash, b.hash,
      'PUNCH must differ between frames, or the comparison above proves nothing',
    );
  });
});

describe('explicit entrance duration changes when motion stops', () => {
  it('a 2-frame entrance has settled by frame 4; the default has not', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const fast = [scene({ style: 'punch', enterFrames: 2 })];
    const normal = [scene({ style: 'punch' })];

    // Settled: frame 4 and frame 30 look the same because the entrance finished.
    const [fastEarly, fastLate] = await Promise.all([still(fast, 4), still(fast, 30)]);
    assert.equal(fastEarly.hash, fastLate.hash, 'a 2-frame entrance must be over by frame 4');

    // CONTROL: the measured default entrance (~9 frames) is still moving at 4.
    const [slowEarly, slowLate] = await Promise.all([still(normal, 4), still(normal, 30)]);
    assert.notEqual(
      slowEarly.hash, slowLate.hash,
      'the default entrance should still be resolving at frame 4',
    );
  });

  it('clamps an entrance longer than the scene instead of overrunning', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    // A 7-frame scene asked for a 40-frame entrance. It must still be fully
    // arrived on its last frame rather than cutting mid-move.
    const scenes = [scene({ duration: 7 / 30, style: 'punch', enterFrames: 40 })];
    const last = await still(scenes, 6);
    const settled = await still([scene({ duration: 7 / 30, style: 'none' })], 6);
    // Not pixel-equal (different styles resolve slightly differently), but the
    // clamped entrance must have reached full opacity — compare ink coverage.
    const cream = [238, 238, 238];
    const movingInk = inkColumns(last.png, Math.round(last.height / 2), cream);
    const staticInk = inkColumns(settled.png, Math.round(settled.height / 2), cream);
    assert.ok(movingInk.length > 0, 'the clamped entrance must have drawn something');
    assert.ok(
      Math.abs(movingInk.length - staticInk.length) / Math.max(1, staticInk.length) < 0.25,
      'a clamped entrance should be essentially arrived by the last frame',
    );
  });
});

describe('custom palette reaches the pixels', () => {
  it('paints an arbitrary background and an explicit ink', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = [scene({ style: 'none', background: 'green' })];
    const frame = await still(scenes, 20, {
      fields: { green: '#1A0DCC' },
      ink: { green: '#FFFFFF' },
    });

    // Top-left corner is always field, never type.
    const corner = pixelAt(frame.png, 4, 4);
    assert.deepEqual(corner, [0x1a, 0x0d, 0xcc], `expected #1A0DCC, got ${corner}`);

    // And there is white ink somewhere on the centre line.
    const row = Math.round(frame.height / 2);
    const ink = inkColumns(frame.png, row, [0x1a, 0x0d, 0xcc]);
    assert.ok(ink.length > 50, 'the type should be visible against the custom field');
    const sample = pixelAt(frame.png, ink[Math.floor(ink.length / 2)], row);
    assert.ok(
      sample[0] > 200 && sample[1] > 200 && sample[2] > 200,
      `expected white ink, got ${sample}`,
    );
  });

  it('CONTROL: without overrides the house field is unchanged', async (t) => {
    if (!serverUp) return t.skip('render server not running');
    const frame = await still([scene({ style: 'none', background: 'green' })], 20);
    const corner = pixelAt(frame.png, 4, 4);
    assert.deepEqual(corner, [0x13, 0x58, 0x1d], `expected the house green, got ${corner}`);
  });
});

describe('fit-to-width never clips', () => {
  const cream = [238, 238, 238];

  for (const [label, text] of [
    ['short text', 'go'],
    ['ordinary text', 'discipline'],
    ['long text', 'consistency beats motivation'],
    ['very long text', 'the quiet compounding of unglamorous daily work'],
  ]) {
    it(`keeps ${label} inside the frame at 88%`, async (t) => {
      if (!serverUp) return t.skip('render server not running');

      const scenes = [
        scene({
          text,
          style: 'none',
          background: 'cream',
          elements: [engine.element(text, { fit: { mode: 'width', maxWidth: 0.88 } })],
        }),
      ];
      const frame = await still(scenes, 20);

      /*
       * Scan several rows so a descender or a single tall letter cannot decide
       * the result, then check the widest extent against the 88% band. The
       * guarantee is one-sided: it may be narrower, never wider.
       */
      let min = Infinity;
      let max = -Infinity;
      for (const fraction of [0.42, 0.46, 0.5, 0.54, 0.58]) {
        const row = Math.round(frame.height * fraction);
        const columns = inkColumns(frame.png, row, cream);
        if (columns.length === 0) continue;
        min = Math.min(min, columns[0]);
        max = Math.max(max, columns[columns.length - 1]);
      }

      assert.ok(Number.isFinite(min), `no ink found for "${text}"`);
      const width = (max - min) / frame.width;
      // Two pixels of tolerance for antialiasing at the edges.
      assert.ok(min >= -2, `"${text}" clipped at the left edge (min ${min})`);
      assert.ok(max <= frame.width + 2, `"${text}" clipped at the right edge (max ${max})`);
      assert.ok(
        width <= 0.9,
        `"${text}" measured ${(width * 100).toFixed(1)}% of the frame, over the 88% fit`,
      );
    });
  }

  it('CONTROL: OVERSIZED is still allowed to bleed past the frame', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = [
      scene({
        text: 'more',
        style: 'none',
        background: 'cream',
        elements: [engine.element('more', { size: 'oversized' })],
      }),
    ];
    const frame = await still(scenes, 20);
    const row = Math.round(frame.height / 2);
    const columns = inkColumns(frame.png, row, cream);
    assert.ok(columns.length > 0, 'expected ink');
    // The bleed policy is a deliberate feature; fit-to-width must not have
    // quietly disabled it for everyone else.
    assert.ok(
      columns[0] <= 2 || columns[columns.length - 1] >= frame.width - 3,
      'OVERSIZED should still touch or exceed the frame edge',
    );
  });
});

describe('accent typeface renders as a different face', () => {
  it('measures and paints differently from the primary face', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const text = 'motivation';
    const primary = await still([
      scene({ text, style: 'none', background: 'cream',
        elements: [engine.element(text, { fontRole: 'primary' })] }),
    ], 20);
    const accent = await still([
      scene({ text, style: 'none', background: 'cream',
        elements: [engine.element(text, { fontRole: 'accent' })] }),
    ], 20);

    assert.notEqual(
      primary.hash, accent.hash,
      'the accent face must actually change the rendered image',
    );
  });
});

/* ------------------------------------------------------- V8.2 (phase two) */

describe('background alternation renders as a strobe', () => {
  const alternating = (everyFrames, times) => [
    engine.blankScene({
      text: 'hold',
      duration: 2,
      style: 'none',
      background: 'cream',
      backgroundMotion: { mode: 'alternate', everyFrames, ...(times ? { times } : {}) },
    }),
  ];

  it('flips the field on the interval and holds it between flips', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = alternating(4);
    // Frames 0-3 are the scene's own field; 4-7 are its partner; 8-11 back again.
    const [a0, a3, b4, b7, c8] = await Promise.all([
      still(scenes, 0), still(scenes, 3), still(scenes, 4), still(scenes, 7), still(scenes, 8),
    ]);

    // Held: within one interval nothing changes at all.
    assert.equal(a0.hash, a3.hash, 'the field must hold for the whole interval');
    assert.equal(b4.hash, b7.hash, 'the second interval must hold too');
    // Flipped: across the boundary it does.
    assert.notEqual(a3.hash, b4.hash, 'the field must change on the interval boundary');
    // And it comes back — this is an alternation, not a one-way change.
    assert.equal(a0.hash, c8.hash, 'the third interval must return to the first field');
  });

  it('changes only the field — the type does not move', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = alternating(4);
    const first = await still(scenes, 1);
    const flipped = await still(scenes, 5);

    // Corners are always field, and they must differ.
    const a = pixelAt(first.png, 4, 4);
    const b = pixelAt(flipped.png, 4, 4);
    assert.notDeepEqual(a, b, 'the field colour should have alternated');

    /*
     * The ink must occupy the same columns in both frames. That is the whole
     * claim of the feature — the type holds while the field changes — and it is
     * what distinguishes this from re-animating the scene on every flip.
     */
    const row = Math.round(first.height / 2);
    const inkA = inkColumns(first.png, row, a);
    const inkB = inkColumns(flipped.png, row, b);
    assert.ok(inkA.length > 0 && inkB.length > 0, 'expected ink in both frames');
    assert.equal(inkA[0], inkB[0], 'the type moved horizontally between flips');
    assert.equal(inkA[inkA.length - 1], inkB[inkB.length - 1], 'the type changed width');
  });

  it('stops after `times` flips and stays on the last field', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    // One flip only: frames 0-3 on the first field, 4 onwards on the second,
    // for ever — no flip back at frame 8.
    const scenes = alternating(4, 1);
    const [before, after, later] = await Promise.all([
      still(scenes, 1), still(scenes, 5), still(scenes, 20),
    ]);
    assert.notEqual(before.hash, after.hash, 'the single flip should have happened');
    assert.equal(after.hash, later.hash, 'no further flips after the limit');
  });

  it('CONTROL: a scene without alternation holds one field throughout', async (t) => {
    if (!serverUp) return t.skip('render server not running');
    const scenes = [scene({ style: 'none', duration: 2 })];
    const [a, b] = await Promise.all([still(scenes, 1), still(scenes, 20)]);
    assert.equal(a.hash, b.hash);
  });
});

describe('word stagger reveals words one at a time', () => {
  const staggered = (delayFrames, order) => [
    engine.blankScene({
      text: 'one two three four',
      duration: 2,
      style: 'punch',
      background: 'cream',
      enterFrames: 1,
      stagger: { type: 'word', delayFrames, ...(order ? { order } : {}) },
    }),
  ];

  /** Roughly how much ink is on screen, summed over several rows. */
  const inkAmount = (frame) => {
    const cream = [238, 238, 238];
    let total = 0;
    for (const fraction of [0.44, 0.48, 0.52, 0.56]) {
      total += inkColumns(frame.png, Math.round(frame.height * fraction), cream).length;
    }
    return total;
  };

  it('adds words progressively rather than all at once', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = staggered(4);
    const frames = await Promise.all([still(scenes, 1), still(scenes, 6), still(scenes, 14)]);
    const amounts = frames.map(inkAmount);

    assert.ok(amounts[0] > 0, 'the first word should already be in');
    assert.ok(amounts[1] > amounts[0], `expected more ink by frame 6, got ${amounts}`);
    assert.ok(amounts[2] > amounts[1], `expected still more by frame 14, got ${amounts}`);
  });

  it('reverses which end starts first', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    /*
     * Compared as whole frames rather than by where the ink sits.
     *
     * A single sampled row is not a safe probe here: `planSingle` splits a
     * sentence into a support line and a hero line, so "first word" and
     * "last word" are on *different lines* and a centre-row scan sees one order
     * and misses the other entirely. Whole-frame comparison asks the question
     * that actually matters — is a different word revealed first? — without
     * assuming anything about the layout.
     */
    const [forwardEarly, reverseEarly] = await Promise.all([
      still(staggered(5, 'forward'), 1),
      still(staggered(5, 'reverse'), 1),
    ]);
    assert.notEqual(
      forwardEarly.hash, reverseEarly.hash,
      'forward and reverse should reveal different words first',
    );

    // By the end both have revealed everything, so they converge — which proves
    // the difference above was ordering rather than one of them dropping words.
    const [forwardLate, reverseLate] = await Promise.all([
      still(staggered(5, 'forward'), 40),
      still(staggered(5, 'reverse'), 40),
    ]);
    assert.equal(
      forwardLate.hash, reverseLate.hash,
      'once every word is in, order should make no difference',
    );
  });

  it('CONTROL: zero stagger puts every word in together', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const scenes = staggered(0);
    const [early, late] = await Promise.all([still(scenes, 3), still(scenes, 20)]);
    assert.equal(
      inkAmount(early), inkAmount(late),
      'with no stagger the whole line should already be in',
    );
  });
});

describe('text exits, all four combinations', () => {
  /**
   * Two scenes, so there is a seam for an exit to happen at. The exit is drawn
   * inside the *second* scene's first frames, which is how the engine overlaps
   * without touching the timeline — so the observation is made there.
   */
  const pair = (style, exit) => [
    engine.blankScene({ text: 'leaving', duration: 1, style, exit, background: 'cream' }),
    engine.blankScene({ text: 'arriving', duration: 1, style: 'none', background: 'cream' }),
  ];

  /** Ink on the first frame of the second scene, where an exit would show. */
  const seamInk = async (scenes) => {
    const cream = [238, 238, 238];
    const frame = await still(scenes, 31);
    let total = 0;
    for (const fraction of [0.40, 0.45, 0.5, 0.55, 0.6]) {
      total += inkColumns(frame.png, Math.round(frame.height * fraction), cream).length;
    }
    return total;
  };

  it('an explicit exit draws outgoing type at the seam', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const withExit = await seamInk(pair('punch', 'punch'));
    const withoutExit = await seamInk(pair('punch', 'none'));

    /*
     * With an exit, the seam frame carries *both* the leaving and the arriving
     * type; with `exit: "none"` it carries only the arriving type. More ink is
     * the observable signature of the overlap.
     */
    assert.ok(
      withExit > withoutExit,
      `exit:punch should leave more ink at the seam than exit:none (${withExit} vs ${withoutExit})`,
    );
  });

  it('expresses all four enter/exit corners and renders each', async (t) => {
    if (!serverUp) return t.skip('render server not running');

    const results = {};
    for (const [style, exit] of [
      ['punch', 'punch'], ['punch', 'none'], ['none', 'punch'], ['none', 'none'],
    ]) {
      results[`${style}/${exit}`] = await seamInk(pair(style, exit));
    }

    // Every combination renders something (the incoming scene is always there).
    for (const [label, amount] of Object.entries(results)) {
      assert.ok(amount > 0, `${label} rendered nothing at the seam`);
    }
    // And in both entrance cases, having an exit shows more than not having one.
    assert.ok(results['punch/punch'] > results['punch/none'], JSON.stringify(results));
    assert.ok(results['none/punch'] > results['none/none'], JSON.stringify(results));
  });
});
