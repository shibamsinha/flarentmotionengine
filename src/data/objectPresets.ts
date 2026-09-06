/**
 * V6 §25 — composition presets.
 *
 * A preset is several objects that already know how to behave together: a card
 * that floats in *and* the icon that draws on above it, a button *and* the
 * pointer that travels over to click it. `newObject` in `objects.ts` makes one
 * thing; this file makes a beat.
 *
 * **Assembly only.** Nothing here is a new engine concept. Every preset is
 * ordinary `SceneObject[]` built from the kinds, surfaces and motion intents
 * that already exist, which is why presets need no schema field, no importer
 * change and no planner change — they are what a user could have built by hand,
 * pre-built. Extending the vocabulary would belong in `objectMotion.ts`; this
 * file may only spend it.
 *
 * **Not `Scene.composition`.** That is the *text* layout enum (`left-stack`,
 * `top-statement`) and is unrelated. These are called object presets in code for
 * that reason, whatever the add menu labels them.
 *
 * Two things make a preset different from a copied literal:
 *
 * 1. **Ids are minted per call and cross-references are wired inside it.** A
 *    cursor's `targetId` has to name the button minted in the same `build()`, so
 *    a preset dropped in twice gives two independent beats rather than two
 *    cursors both driving the first button. This is the reason `build()` is a
 *    function and not a frozen constant — the same reason `Preset.build()` in
 *    `presets.ts` is.
 * 2. **A preset declares how long it needs.** A three-second beat dropped into a
 *    0.9s scene would be cut off mid-click, and the preset would look broken
 *    when it was the scene that was too short. `seconds` lets the editor widen
 *    the scene to fit; it never shortens one.
 *
 * Geometry is in frame fractions with a top-left origin, so every preset
 * composes the same way in portrait and landscape.
 */

import type { SceneObject } from '../types/object';
import { makeElementId } from './defaultScenes';

/** Shared with `v6Demos.ts` by eye, not by import — the demos are a fixture. */
const PANEL = {
  fill: '#16181B',
  radius: 0.09,
  shadow: 'strong' as const,
  stroke: 'rgba(255,255,255,0.07)',
  strokeWidth: 1,
};

const ACCENT = '#4ADE6A';
const INK = '#F2F4F2';
const MUTED = '#8A928A';
const ON_ACCENT = '#0C0D0C';

export type ObjectPreset = {
  id: string;
  /** What the add menu calls it. */
  name: string;
  /** One line on what it is for. */
  hint: string;
  /**
   * Seconds the beat needs to play out. The editor widens the scene to at least
   * this; a longer scene is left alone.
   */
  seconds: number;
  /** Fresh ids, and cross-references wired, on every call. */
  build: () => SceneObject[];
};

/* ------------------------------------------------------------ the presets */

/**
 * A card arrives and an icon draws on above it. The plainest useful beat, and
 * the one to reach for when a scene just needs to say one thing with a surface
 * behind it.
 */
const cardIntro = (): SceneObject[] => [
  {
    id: makeElementId(),
    type: 'icon',
    icon: 'star',
    x: 0.44, y: 0.19, width: 0.12, height: 0.09,
    color: ACCENT,
    weight: 2.4,
    motion: { enter: 'draw-in', speed: 'medium' },
    start: 0.15,
  },
  {
    id: makeElementId(),
    type: 'card',
    x: 0.12, y: 0.32, width: 0.76, height: 0.28,
    surface: PANEL,
    title: { text: 'Built for speed', size: 0.042, weight: 600, color: INK },
    body: { text: 'Everything in one place', size: 0.024, weight: 400, color: MUTED },
    motion: { enter: 'float-in', speed: 'medium', distance: 'medium', delay: 0.25 },
  },
];

/**
 * The reference video's core beat: a button, a pointer that arcs over to it,
 * a click that drives it to SUCCESS, and a checkmark drawing on.
 *
 * The cursor's `targetId` is the whole reason this file exists — it has to name
 * the button built beside it, which a static literal cannot do.
 */
const buttonInteraction = (): SceneObject[] => {
  const buttonId = makeElementId();
  return [
    {
      id: buttonId,
      type: 'button',
      x: 0.30, y: 0.44, width: 0.40, height: 0.085,
      label: { text: 'Get started', size: 0.030, weight: 600, color: ON_ACCENT },
      surface: { fill: INK, radius: 0.5, shadow: 'soft' },
      stateStyles: {
        pressed: { fill: '#D6DAD6', radius: 0.5, shadow: 'none' },
        success: {
          fill: ACCENT,
          radius: 0.5,
          glow: 'medium',
          glowColor: 'rgba(74,222,106,0.45)',
          label: { text: 'You’re in', size: 0.030, weight: 600, color: ON_ACCENT },
        },
      },
      motion: { enter: 'pop-in', speed: 'fast', delay: 0.2 },
    },
    {
      id: makeElementId(),
      type: 'cursor',
      // A cursor's box is unused; the stops carry its position.
      x: 0.8, y: 0.9, width: 0.06, height: 0.06,
      stops: [
        { x: 0.86, y: 0.92, at: 0 },
        // An arc, not a straight line — a hand does not travel on rails.
        { x: 0.50, y: 0.4825, at: 1.5, travel: 0.8, path: 'arc' },
        {
          x: 0.50, y: 0.4825, at: 1.75,
          action: 'click',
          targetId: buttonId,
          targetState: 'success',
        },
      ],
    },
    {
      id: makeElementId(),
      type: 'icon',
      icon: 'check',
      x: 0.455, y: 0.60, width: 0.09, height: 0.09,
      color: ACCENT,
      weight: 2.6,
      motion: { enter: 'draw-in', speed: 'fast' },
      start: 1.95,
    },
  ];
};

/** Three cards staggering in — the "what you get" beat. */
const featureCards = (): SceneObject[] => {
  const copy: [string, string, string][] = [
    ['scan', 'Capture', 'Point and shoot'],
    ['upload', 'Upload', 'Straight to the cloud'],
    ['star', 'Share', 'One link, anywhere'],
  ];
  return [
    {
      id: makeElementId(),
      type: 'group',
      x: 0.12, y: 0.26, width: 0.76, height: 0.48,
      sequence: 'stagger',
      stagger: 0.14,
      children: copy.map(([icon, title, body], i) => ({
        id: makeElementId(),
        type: 'card' as const,
        // Thirds of the group box, with a gap left between them.
        x: 0, y: i * 0.355, width: 1, height: 0.29,
        surface: PANEL,
        title: { text: title, size: 0.032, weight: 600, color: INK },
        body: { text: body, size: 0.022, weight: 400, color: MUTED },
        motion: { enter: 'float-in' as const, speed: 'medium' as const, distance: 'small' as const },
        children: [
          {
            id: makeElementId(),
            type: 'icon' as const,
            icon,
            // Addressed in the card's own fractions, not the frame's.
            x: 0.06, y: 0.3, width: 0.12, height: 0.4,
            color: ACCENT,
            motion: { enter: 'draw-in' as const, speed: 'fast' as const, delay: 0.2 },
          },
        ],
      })),
    } as SceneObject,
  ];
};

/** Rows ticking off one after another. The "and it does all this" beat. */
const checklist = (): SceneObject[] => {
  const lines = ['No templates', 'No timeline', 'No excuses'];
  return [
    {
      id: makeElementId(),
      type: 'group',
      x: 0.14, y: 0.34, width: 0.72, height: 0.32,
      sequence: 'stagger',
      stagger: 0.22,
      children: lines.map((text, i) => ({
        id: makeElementId(),
        type: 'group' as const,
        x: 0, y: i * 0.36, width: 1, height: 0.28,
        motion: {
          enter: 'slide-in' as const,
          from: 'left' as const,
          speed: 'fast' as const,
          distance: 'small' as const,
        },
        children: [
          {
            id: makeElementId(),
            type: 'icon' as const,
            icon: 'check' as const,
            x: 0, y: 0.1, width: 0.11, height: 0.8,
            color: ACCENT,
            weight: 2.6,
            motion: { enter: 'draw-in' as const, speed: 'fast' as const, delay: 0.18 },
          },
          {
            // A card with no fill is the way to place a line of type inside a
            // group — the surface is what makes it a card, and it is optional.
            id: makeElementId(),
            type: 'card' as const,
            x: 0.16, y: 0, width: 0.84, height: 1,
            surface: {},
            title: { text, size: 0.034, weight: 600, color: INK, align: 'left' as const },
          },
        ],
      })),
    } as SceneObject,
  ];
};

/** Bars filling in sequence. Progress, throughput, "it is working". */
const progressRows = (): SceneObject[] => [
  {
    id: makeElementId(),
    type: 'group',
    x: 0.12, y: 0.36, width: 0.76, height: 0.28,
    sequence: 'stagger',
    stagger: 0.16,
    children: [0, 1, 2].map((i) => ({
      id: makeElementId(),
      type: 'group' as const,
      x: 0, y: i * 0.36, width: 1, height: 0.24,
      motion: {
        enter: 'slide-in' as const,
        from: 'left' as const,
        speed: 'fast' as const,
        distance: 'small' as const,
      },
      children: [
        {
          id: makeElementId(),
          type: 'shape' as const,
          shape: 'rounded' as const,
          x: 0, y: 0.32, width: 0.86, height: 0.32,
          surface: { fill: 'rgba(255,255,255,0.12)', radius: 0.5 },
        },
        {
          // A wipe, not a slide: the bar fills rather than arriving.
          id: makeElementId(),
          type: 'shape' as const,
          shape: 'rounded' as const,
          x: 0, y: 0.32, width: 0.86, height: 0.32,
          surface: { fill: ACCENT, radius: 0.5 },
          motion: {
            enter: 'reveal' as const,
            from: 'left' as const,
            speed: 'slow' as const,
            delay: 0.25,
          },
        },
        {
          id: makeElementId(),
          type: 'icon' as const,
          icon: 'check' as const,
          x: 0.9, y: 0.24, width: 0.1, height: 0.48,
          color: ACCENT,
          motion: { enter: 'draw-in' as const, speed: 'fast' as const, delay: 1.15 },
        },
      ],
    })),
  } as SceneObject,
];

/**
 * A name strap that wipes in low in the frame. The one preset here that is a
 * broadcast convention rather than a product-demo one, and the one most likely
 * to be dropped over footage.
 */
const lowerThird = (): SceneObject[] => {
  const barId = makeElementId();
  return [
    {
      id: barId,
      type: 'shape',
      shape: 'rounded',
      x: 0.08, y: 0.74, width: 0.84, height: 0.115,
      surface: { ...PANEL, radius: 0.06 },
      motion: { enter: 'reveal', from: 'left', speed: 'medium' },
    },
    {
      id: makeElementId(),
      type: 'shape',
      shape: 'rounded',
      // The accent rule down the leading edge.
      x: 0.10, y: 0.757, width: 0.008, height: 0.08,
      surface: { fill: ACCENT, radius: 0.5 },
      motion: { enter: 'reveal', from: 'bottom', speed: 'fast', delay: 0.3 },
    },
    {
      id: makeElementId(),
      type: 'card',
      x: 0.13, y: 0.74, width: 0.76, height: 0.115,
      surface: {},
      title: { text: 'Flarent', size: 0.036, weight: 600, color: INK, align: 'left' },
      body: { text: 'Motion, without the timeline', size: 0.021, color: MUTED, align: 'left' },
      motion: { enter: 'fade-in', speed: 'medium', delay: 0.35 },
    },
  ];
};

/**
 * The order the menu offers them in: the two the brief names first, then the
 * multi-row beats, then the broadcast one.
 */
export const OBJECT_PRESETS: ObjectPreset[] = [
  {
    id: 'card-intro',
    name: 'UI Card Intro',
    hint: 'A card floats in under a drawn icon',
    seconds: 2.4,
    build: cardIntro,
  },
  {
    id: 'button-interaction',
    name: 'Button Interaction',
    hint: 'A pointer arcs over, clicks, and the button succeeds',
    seconds: 3.2,
    build: buttonInteraction,
  },
  {
    id: 'feature-cards',
    name: 'Feature Cards',
    hint: 'Three cards stagger in, each with its own icon',
    seconds: 2.8,
    build: featureCards,
  },
  {
    id: 'checklist',
    name: 'Checklist',
    hint: 'Lines slide in and tick off one by one',
    seconds: 3.0,
    build: checklist,
  },
  {
    id: 'progress-rows',
    name: 'Progress Rows',
    hint: 'Bars fill in sequence, then check off',
    seconds: 3.0,
    build: progressRows,
  },
  {
    id: 'lower-third',
    name: 'Lower Third',
    hint: 'A name strap wipes in low in the frame',
    seconds: 2.6,
    build: lowerThird,
  },
];
