/**
 * V6 demo reels.
 *
 * These exist to be watched, not to be shipped as templates. Each one is the
 * reel to open when judging whether a part of V6 actually works, in the same
 * spirit as the V2/V3/V4 test reels in `presets.ts`.
 *
 * The important one is `v6Mixed`: scene 2 carries kinetic typography *and* a
 * card, a button, a cursor and an icon in the same frame. That is the brief's
 * hardest requirement — typography and motion graphics coexisting rather than
 * one replacing the other — and it is the scene to check first if anything
 * about V6 looks wrong.
 *
 * Geometry is in frame fractions with a top-left origin, so these compose the
 * same way in portrait and landscape.
 */

import type { Scene } from '../types/scene';
import type { SceneObject } from '../types/object';
import { blankScene, element } from './defaultScenes';

const s = blankScene;

/** The card surface used through the demos. Dark, lifted, softly lit. */
const PANEL = {
  fill: '#16181B',
  radius: 0.09,
  shadow: 'strong' as const,
  stroke: 'rgba(255,255,255,0.07)',
  strokeWidth: 1,
};

const ACCENT = '#4ADE6A';

/**
 * The reference video's core beat, rebuilt: a card arrives, a button pops in,
 * the pointer travels to it and clicks, the button changes state, and a
 * checkmark draws itself on.
 *
 * Every one of those is an intent — FLOAT IN, POP IN, "move here then click",
 * "then be SUCCESS", DRAW IN. Nothing in this file names a coordinate curve or
 * a keyframe, which is the point.
 */
const uploadBeat = (): SceneObject[] => [
  {
    id: 'card',
    type: 'card',
    x: 0.12, y: 0.30, width: 0.76, height: 0.30,
    surface: PANEL,
    title: { text: 'Upload your file', size: 0.042, weight: 600, color: '#F2F4F2' },
    body: { text: 'PDF, PNG or JPG · up to 24MB', size: 0.024, weight: 400, color: '#8A928A' },
    motion: { enter: 'float-in', speed: 'medium', distance: 'medium' },
    start: 0.1,
  },
  {
    id: 'button',
    type: 'button',
    x: 0.30, y: 0.635, width: 0.40, height: 0.085,
    label: { text: 'Upload', size: 0.030, weight: 600, color: '#0C0D0C' },
    icon: 'upload',
    surface: { fill: '#F2F4F2', radius: 0.5, shadow: 'soft' },
    // Only the states that differ need declaring; the rest fall back.
    stateStyles: {
      pressed: { fill: '#D6DAD6', radius: 0.5, shadow: 'none' },
      success: {
        fill: ACCENT,
        radius: 0.5,
        glow: 'medium',
        glowColor: 'rgba(74,222,106,0.45)',
        label: { text: 'Uploaded', size: 0.030, weight: 600, color: '#0C0D0C' },
      },
    },
    motion: { enter: 'pop-in', speed: 'fast', delay: 0.45 },
    start: 0.1,
  },
  {
    id: 'pointer',
    type: 'cursor',
    // The box is unused for a cursor; its stops carry the position.
    x: 0.8, y: 0.9, width: 0.06, height: 0.06,
    stops: [
      { x: 0.86, y: 0.92, at: 0 },
      // An arc rather than a straight line — a hand does not travel on rails.
      { x: 0.50, y: 0.678, at: 1.9, travel: 0.85, path: 'arc' },
      {
        x: 0.50, y: 0.678, at: 2.15,
        action: 'click',
        targetId: 'button',
        targetState: 'success',
      },
    ],
  },
  {
    id: 'tick',
    type: 'icon',
    icon: 'check',
    x: 0.455, y: 0.775, width: 0.09, height: 0.09,
    color: ACCENT,
    weight: 2.6,
    motion: { enter: 'draw-in', speed: 'fast' },
    start: 2.35,
  },
];

/** Four progress rows that fill in sequence — the upload beat of the reference. */
const uploadRows = (): SceneObject[] => [
  {
    id: 'rows',
    type: 'group',
    x: 0.12, y: 0.34, width: 0.76, height: 0.32,
    // The engine works out each child's offset; the author says "stagger".
    sequence: 'stagger',
    stagger: 0.16,
    children: [0, 1, 2, 3].map((i) => ({
      id: `row-${i}`,
      type: 'group' as const,
      x: 0, y: i * 0.26, width: 1, height: 0.2,
      motion: { enter: 'slide-in' as const, from: 'left' as const, speed: 'fast' as const, distance: 'small' as const },
      children: [
        {
          id: `chip-${i}`,
          type: 'shape' as const,
          shape: 'rounded' as const,
          x: 0, y: 0.1, width: 0.09, height: 0.8,
          surface: { fill: '#E5484D', radius: 0.25 },
        },
        {
          id: `track-${i}`,
          type: 'shape' as const,
          shape: 'rounded' as const,
          x: 0.14, y: 0.42, width: 0.7, height: 0.16,
          surface: { fill: 'rgba(255,255,255,0.12)', radius: 0.5 },
        },
        {
          id: `fill-${i}`,
          type: 'shape' as const,
          shape: 'rounded' as const,
          x: 0.14, y: 0.42, width: 0.7, height: 0.16,
          surface: { fill: ACCENT, radius: 0.5 },
          // A wipe, not a slide: the bar fills rather than arriving.
          motion: { enter: 'reveal' as const, from: 'left' as const, speed: 'slow' as const, delay: 0.25 },
        },
        {
          id: `done-${i}`,
          type: 'icon' as const,
          icon: 'check' as const,
          x: 0.89, y: 0.28, width: 0.1, height: 0.44,
          color: ACCENT,
          motion: { enter: 'draw-in' as const, speed: 'fast' as const, delay: 1.15 },
        },
      ],
    })),
  },
];

/**
 * The mixed reel. Typography and motion graphics in one film, and in scene 2,
 * in one frame.
 */
export const v6Mixed = (): Scene[] => [
  // Pure V2/V3 typography. Untouched by V6 — this is the control.
  s({
    duration: 1.5,
    text: "HERE'S HOW\nIT WORKS",
    case: 'as-typed',
    background: 'black',
    style: 'slide',
    composition: 'left-stack',
    elements: [
      element("HERE'S HOW", { role: 'secondary', animation: 'slide' }),
      element('IT WORKS', { role: 'primary', animation: 'punch', delay: 0.12 }),
    ],
  }),

  /*
   * The coexistence test. A kinetic-typography headline animates through the
   * existing engine while a card, a button, a pointer and an icon animate
   * through the new one, in the same frame, over the same field.
   */
  s({
    duration: 3.2,
    text: 'ONE TAP',
    case: 'as-typed',
    background: 'black',
    style: 'punch',
    composition: 'top-statement',
    elements: [element('ONE TAP', { role: 'secondary', animation: 'punch' })],
    objects: uploadBeat(),
  }),

  s({
    duration: 3.0,
    text: 'UPLOADING',
    case: 'as-typed',
    background: 'black',
    style: 'slide',
    composition: 'top-statement',
    elements: [element('UPLOADING', { role: 'secondary', animation: 'slide' })],
    objects: uploadRows(),
  }),

  // Back to pure typography for the close, with one drawn icon over it.
  s({
    duration: 2.2,
    text: 'DONE.',
    case: 'as-typed',
    background: 'green',
    style: 'massive',
    composition: 'oversized-center',
    elements: [
      element('DONE.', { role: 'emphasis', size: 'oversized', animation: 'massive' }),
    ],
  }),
];

/**
 * The object catalogue — every kind and every entrance, on one field, so a
 * change to the motion vocabulary can be judged at a glance rather than
 * described.
 */
export const v6Objects = (): Scene[] => [
  s({
    duration: 3.4,
    text: '',
    case: 'as-typed',
    background: 'black',
    style: 'punch',
    elements: [],
    objects: [
      {
        id: 'g', type: 'group',
        x: 0.08, y: 0.18, width: 0.84, height: 0.64,
        sequence: 'stagger', stagger: 0.13,
        children: [
          { id: 'o1', type: 'shape', shape: 'circle', x: 0, y: 0, width: 0.2, height: 0.11,
            surface: { fill: ACCENT }, motion: { enter: 'pop-in', speed: 'fast' } },
          { id: 'o2', type: 'shape', shape: 'rounded', x: 0.27, y: 0, width: 0.2, height: 0.11,
            surface: { fill: '#F2F4F2', radius: 0.2 }, motion: { enter: 'float-in', speed: 'medium' } },
          { id: 'o3', type: 'icon', icon: 'folder', x: 0.55, y: 0, width: 0.14, height: 0.11,
            color: '#F2F4F2', motion: { enter: 'draw-in', speed: 'medium' } },
          { id: 'o4', type: 'icon', icon: 'bell', x: 0.78, y: 0, width: 0.14, height: 0.11,
            color: ACCENT, motion: { enter: 'draw-in', speed: 'slow' } },
          { id: 'o5', type: 'card', x: 0, y: 0.2, width: 0.47, height: 0.24,
            surface: PANEL,
            title: { text: 'Feature card', size: 0.030, weight: 600, color: '#F2F4F2' },
            body: { text: 'Float In', size: 0.022, color: '#8A928A' },
            motion: { enter: 'float-in', speed: 'medium' } },
          { id: 'o6', type: 'card', x: 0.53, y: 0.2, width: 0.47, height: 0.24,
            surface: { ...PANEL, glow: 'low', glowColor: 'rgba(74,222,106,0.35)' },
            title: { text: 'Glowing', size: 0.030, weight: 600, color: '#F2F4F2' },
            body: { text: 'Rise In', size: 0.022, color: '#8A928A' },
            motion: { enter: 'rise-in', speed: 'medium' } },
          { id: 'o7', type: 'button', x: 0, y: 0.52, width: 0.44, height: 0.1,
            label: { text: 'Pop In', size: 0.026, weight: 600, color: '#0C0D0C' },
            surface: { fill: '#F2F4F2', radius: 0.5, shadow: 'soft' },
            motion: { enter: 'pop-in', speed: 'fast', emphasis: 'pulse' } },
          { id: 'o8', type: 'button', x: 0.53, y: 0.52, width: 0.47, height: 0.1,
            label: { text: 'Slide In', size: 0.026, weight: 600, color: '#0C0D0C' },
            icon: 'arrow-right',
            surface: { fill: ACCENT, radius: 0.5, shadow: 'soft' },
            motion: { enter: 'slide-in', from: 'right', speed: 'fast', distance: 'medium' } },
          { id: 'o9', type: 'shape', shape: 'line', x: 0, y: 0.72, width: 1, height: 0.008,
            surface: { fill: 'rgba(255,255,255,0.25)' },
            motion: { enter: 'reveal', from: 'left', speed: 'slow' } },
        ],
      },
    ],
  }),
];
