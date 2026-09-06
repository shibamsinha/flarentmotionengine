/**
 * The auto-save round trip.
 *
 * `loadProject` is a whitelist: it rebuilds every scene field by field rather
 * than trusting what is in storage. That is the right shape for a restore path
 * — a corrupt payload must not be able to crash the editor into a blank screen
 * — but it has one failure mode, and the codebase has already hit it. V6 added
 * `objects` to `Scene`, to the renderer, to the importer and to the canvas, and
 * not to this whitelist. The save wrote them; the restore silently dropped
 * them; every card, button and cursor vanished on refresh, for two versions,
 * without a single test noticing.
 *
 * So these tests are deliberately not "does `objects` survive". They are "does
 * *everything* survive" — the suite walks the scene the editor can actually
 * produce and asserts the whole thing comes back. A field added to `Scene` and
 * forgotten here should fail loudly the next time someone runs the gate.
 *
 * Runs in Node, so it stubs the one browser API the module needs. That stub is
 * the whole environment: `persistence.ts` touches nothing else.
 */

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { loadEngine } from '../mcp/lib/engine.mjs';

let engine;

/** A localStorage that behaves like the real one, including the throw. */
const installStorage = () => {
  const map = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
  };
  return map;
};

before(async () => {
  installStorage();
  engine = await loadEngine();
});

beforeEach(() => {
  installStorage();
});

/** Save, restore, and hand back the scene that came out. */
const roundTrip = (scenes, extra = {}) => {
  const project = {
    scenes,
    palette: 'forest',
    format: 'portrait',
    fields: {},
    ink: {},
    accent: null,
    overlay: null,
    audio: null,
    title: 'Persistence test',
    selectedId: scenes[0]?.id ?? null,
    ...extra,
  };
  assert.equal(engine.saveProject(project), true, 'save failed');
  const restored = engine.loadProject();
  assert.notEqual(restored, null, 'restore returned null');
  return restored;
};

/** One of every object kind, nested the way the editor nests them. */
const everyObjectKind = () => [
  {
    id: 'o-shape', type: 'shape', shape: 'rounded',
    x: 0.1, y: 0.1, width: 0.3, height: 0.2,
    surface: { fill: '#123456', radius: 0.08, shadow: 'strong', glow: 'low', glowColor: '#4ADE6A' },
    motion: { enter: 'pop-in', speed: 'fast', distance: 'large', from: 'left' },
  },
  {
    id: 'o-image', type: 'image', src: 'uploads/x.png',
    x: 0.1, y: 0.4, width: 0.3, height: 0.2, fit: 'cover',
  },
  {
    id: 'o-logo', type: 'logo', src: 'uploads/logo.svg',
    x: 0.5, y: 0.4, width: 0.2, height: 0.1, fit: 'contain',
  },
  {
    id: 'o-icon', type: 'icon', icon: 'check',
    x: 0.5, y: 0.1, width: 0.1, height: 0.1, color: '#FFFFFF', weight: 2.5,
  },
  {
    id: 'o-button', type: 'button',
    x: 0.1, y: 0.7, width: 0.4, height: 0.1,
    label: { text: 'Get started', color: '#0C0D0C', size: 0.03, weight: 600 },
    icon: 'arrow-right',
    surface: { fill: '#F2F4F2' },
    stateStyles: { success: { fill: '#4ADE6A', label: { text: 'Done' } } },
    states: [{ at: 1.2, to: 'success', transition: 'smooth' }],
  },
  {
    id: 'o-cursor', type: 'cursor', variant: 'hand', color: '#FFFFFF',
    x: 0.5, y: 0.5, width: 0.05, height: 0.05,
    stops: [
      { x: 0.2, y: 0.2, at: 0 },
      { x: 0.3, y: 0.75, at: 1, travel: 0.6, path: 'arc', action: 'click', targetId: 'o-button', targetState: 'success' },
    ],
  },
  {
    id: 'o-card', type: 'card',
    x: 0.05, y: 0.05, width: 0.9, height: 0.5,
    title: { text: 'Card title' }, body: { text: 'Supporting line' },
    surface: { fill: '#16181B', radius: 0.09 },
    sequence: 'stagger', stagger: 0.12,
    children: [
      {
        id: 'o-card-child', type: 'shape', shape: 'circle',
        x: 0.1, y: 0.1, width: 0.2, height: 0.2,
        surface: { fill: '#4ADE6A' },
      },
    ],
  },
  {
    id: 'o-group', type: 'group', sequence: 'after', stagger: 0.2,
    x: 0, y: 0, width: 1, height: 1,
    children: [
      {
        id: 'o-group-child', type: 'icon', icon: 'star',
        x: 0.4, y: 0.4, width: 0.1, height: 0.1,
      },
    ],
  },
];

describe('objects survive the auto-save', () => {
  it('restores all eight object kinds byte-for-byte', () => {
    const objects = everyObjectKind();
    const scene = { ...engine.blankScene({ text: 'objects' }), objects };
    const restored = roundTrip([scene]);
    assert.deepEqual(restored.scenes[0].objects, objects);
  });

  it('restores children nested inside a card and a group', () => {
    const scene = { ...engine.blankScene({ text: 'nested' }), objects: everyObjectKind() };
    const restored = roundTrip([scene]);
    const card = restored.scenes[0].objects.find((o) => o.id === 'o-card');
    const group = restored.scenes[0].objects.find((o) => o.id === 'o-group');
    assert.equal(card.children.length, 1);
    assert.equal(card.children[0].id, 'o-card-child');
    assert.equal(group.children.length, 1);
    assert.equal(group.children[0].id, 'o-group-child');
  });

  it('keeps a cursor’s stops, including the action that drives another object', () => {
    const scene = { ...engine.blankScene({ text: 'cursor' }), objects: everyObjectKind() };
    const restored = roundTrip([scene]);
    const cursor = restored.scenes[0].objects.find((o) => o.id === 'o-cursor');
    assert.equal(cursor.stops.length, 2);
    assert.equal(cursor.stops[1].action, 'click');
    assert.equal(cursor.stops[1].targetId, 'o-button');
    assert.equal(cursor.stops[1].targetState, 'success');
  });

  it('CONTROL: a scene with no objects still restores without the key', () => {
    const restored = roundTrip([engine.blankScene({ text: 'plain' })]);
    assert.equal('objects' in restored.scenes[0], false);
  });
});

describe('a corrupt object costs itself, not the scene', () => {
  const withObjects = (objects) =>
    roundTrip([{ ...engine.blankScene({ text: 'mixed' }), objects }]);

  it('drops an entry whose kind the engine does not know', () => {
    const restored = withObjects([
      { id: 'bad', type: 'hologram', x: 0, y: 0, width: 0.1, height: 0.1 },
      { id: 'good', type: 'shape', shape: 'circle', x: 0, y: 0, width: 0.1, height: 0.1 },
    ]);
    assert.deepEqual(restored.scenes[0].objects.map((o) => o.id), ['good']);
  });

  it('drops an entry with no box rather than placing it at the origin', () => {
    const restored = withObjects([
      { id: 'boxless', type: 'shape', shape: 'circle' },
      { id: 'good', type: 'shape', shape: 'circle', x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
    ]);
    assert.deepEqual(restored.scenes[0].objects.map((o) => o.id), ['good']);
  });

  it('normalises a cursor whose stops are not an array', () => {
    const restored = withObjects([
      { id: 'c', type: 'cursor', x: 0, y: 0, width: 0.05, height: 0.05, stops: 'nonsense' },
    ]);
    assert.deepEqual(restored.scenes[0].objects[0].stops, []);
  });

  it('normalises a card whose children are not an array', () => {
    const restored = withObjects([
      { id: 'c', type: 'card', x: 0, y: 0, width: 0.5, height: 0.5, children: 42 },
    ]);
    assert.equal('children' in restored.scenes[0].objects[0], false);
  });

  it('stops recursing before a deep tree can exhaust the stack', () => {
    let node = { id: 'leaf', type: 'shape', shape: 'circle', x: 0, y: 0, width: 0.1, height: 0.1 };
    for (let i = 0; i < 40; i++) {
      node = { id: `g${i}`, type: 'group', x: 0, y: 0, width: 1, height: 1, children: [node] };
    }
    const restored = withObjects([node]);
    let depth = 0;
    for (let o = restored.scenes[0].objects[0]; o?.children?.length; o = o.children[0]) depth++;
    assert.ok(depth > 0, 'nesting was flattened entirely');
    assert.ok(depth <= 6, `nesting ran ${depth} deep, past the cap`);
  });
});

/**
 * The guard against the next occurrence of this bug. Everything the editor can
 * put on a scene, in one object, asserted whole — so a field added to `Scene`
 * and forgotten in the whitelist fails here rather than in someone's reel.
 */
describe('every scene field the editor can write survives', () => {
  it('restores a scene using the whole model', () => {
    const scene = {
      ...engine.blankScene({ text: 'everything' }),
      duration: 1.6,
      style: 'massive',
      background: 'cream',
      alignment: 'right',
      emphasis: ['everything'],
      wordColors: { everything: '#4ADE6A' },
      fontSize: 1.4,
      fontRole: 'accent',
      case: 'upper',
      direction: 'left',
      flipBackground: true,
      enterFrames: 5,
      exit: 'stack',
      exitFrames: 3,
      stagger: { type: 'word', delayFrames: 2, order: 'reverse' },
      backgroundMotion: { mode: 'alternate', everyFrames: 4, times: 6 },
      fit: { mode: 'width', maxWidth: 0.88 },
      composition: 'left-stack',
      visualStyle: 'gradient',
      styleConfig: { type: 'gradient', gradient: { colors: ['#FFF', '#000'], angle: 45 } },
      hideOverlay: true,
      note: 'from an imported script',
      image: { src: 'uploads/pic.jpg', placement: 'full', scrim: 0.42 },
      objects: everyObjectKind(),
    };

    const restored = roundTrip([scene]).scenes[0];

    for (const key of Object.keys(scene)) {
      assert.deepEqual(
        restored[key],
        scene[key],
        `\`${key}\` did not survive the auto-save — is it missing from sanitiseScene?`,
      );
    }
  });

  it('restores a composed scene using the whole element model', () => {
    // `wordColors` was missing from `sanitiseElement` as well as from
    // `sanitiseScene`, so the element surface gets the same exhaustive walk.
    const element = {
      id: 'el-1',
      text: 'every element field',
      role: 'primary',
      size: 'huge',
      position: 'top-left',
      from: 'bottom-right',
      animation: 'slide',
      align: 'left',
      case: 'upper',
      visualStyle: 'outline',
      styleConfig: { type: 'outline', strokeColor: '#FFFFFF', strokeWidth: 0.03 },
      emphasis: ['every'],
      wordColors: { every: '#4ADE6A' },
      scale: 1.2,
      delay: 0.25,
      enterFrames: 4,
      fit: { mode: 'width', maxWidth: 0.9 },
      exit: 'none',
      stagger: { type: 'word', delayFrames: 3 },
      fontRole: 'accent',
      x: 0.3,
      y: 0.4,
    };

    const scene = { ...engine.blankScene({ text: 'composed' }), elements: [element] };
    const restored = roundTrip([scene]).scenes[0].elements[0];

    for (const key of Object.keys(element)) {
      assert.deepEqual(
        restored[key],
        element[key],
        `\`${key}\` did not survive the auto-save — is it missing from sanitiseElement?`,
      );
    }
  });

  it('restores the project-level fields around the scenes', () => {
    const restored = roundTrip([engine.blankScene({ text: 'project' })], {
      palette: 'ink',
      format: 'landscape',
      fields: { green: '#135810' },
      ink: { cream: '#214E1B' },
      accent: '#4ADE6A',
      title: 'A named reel',
      overlay: { src: 'uploads/mark.png', x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      audio: {
        src: 'uploads/track.wav', name: 'track.wav', sourceDuration: 30,
        sourceStart: 2, sourceEnd: 9, timelineStart: 1, volume: 0.8,
      },
    });

    assert.equal(restored.palette, 'ink');
    assert.equal(restored.format, 'landscape');
    assert.deepEqual(restored.fields, { green: '#135810' });
    assert.deepEqual(restored.ink, { cream: '#214E1B' });
    assert.equal(restored.accent, '#4ADE6A');
    assert.equal(restored.title, 'A named reel');
    assert.equal(restored.overlay.src, 'uploads/mark.png');
    assert.equal(restored.audio.src, 'uploads/track.wav');
    assert.equal(restored.audio.sourceEnd, 9);
  });
});
