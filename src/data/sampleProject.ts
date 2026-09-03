/**
 * The sample document offered on the import screen.
 *
 * It exists to be read, not to be watched: someone who has never seen the
 * schema — or an LLM being asked to write one — should be able to copy this and
 * work out the shape of a project from it.
 *
 * **It is generated, never hand-written.** `sampleProjectJson()` builds real
 * `Scene[]` and runs them through `serialiseProject`, the same function the
 * Extract button uses. That is deliberate: a hand-maintained sample drifts from
 * the schema the moment a field is added or renamed, and a sample that lies is
 * worse than no sample. Because this goes through the real serialiser it cannot
 * be invalid, and it picks up new fields automatically.
 *
 * The regression gate covers it (`scripts/baseline.mjs`), so if a schema change
 * alters the sample, that shows up as a reviewable diff rather than a surprise.
 *
 * **When adding a feature, add it here.** The rule of thumb: the sample should
 * demonstrate every *concept* — not every value — so keep one example of each
 * idea and let the vocabulary lists in SCHEMA.md carry the rest.
 */

import type { Scene } from '../types/scene';
import type { SceneObject } from '../types/object';
import { blankScene, element } from './defaultScenes';
import { serialiseProject } from '../utils/importScript';

const ACCENT = '#4ADE6A';
const INK = '#F2F4F2';

/**
 * Four scenes, chosen so each one introduces exactly one idea:
 *   1. plain text — the smallest scene that renders
 *   2. elements — composition, roles, per-element animation and visual style
 *   3. objects — motion graphics, timing, states, a cursor that clicks
 *   4. both at once — the thing V6 exists to make possible
 */
const sampleScenes = (): Scene[] => {
  const uiObjects: SceneObject[] = [
    {
      id: 'card-1',
      type: 'card',
      x: 0.12, y: 0.32, width: 0.76, height: 0.26,
      surface: {
        fill: '#16181B', radius: 0.09, shadow: 'strong',
        stroke: 'rgba(255,255,255,0.07)', strokeWidth: 1,
      },
      title: { text: 'Upload your file', size: 0.04, weight: 600, color: INK },
      body: { text: 'PDF, PNG or JPG', size: 0.022, color: '#8A928A' },
      motion: { enter: 'float-in', speed: 'medium', distance: 'medium' },
    },
    {
      id: 'button-1',
      type: 'button',
      x: 0.30, y: 0.63, width: 0.40, height: 0.085,
      label: { text: 'Upload', size: 0.03, weight: 600, color: '#0C0D0C' },
      icon: 'upload',
      surface: { fill: INK, radius: 0.5, shadow: 'soft' },
      stateStyles: {
        success: {
          fill: ACCENT, radius: 0.5, glow: 'medium',
          glowColor: 'rgba(74,222,106,0.45)',
          label: { text: 'Uploaded', size: 0.03, weight: 600, color: '#0C0D0C' },
        },
      },
      motion: { enter: 'pop-in', speed: 'fast', delay: 0.4 },
    },
    {
      id: 'pointer-1',
      type: 'cursor',
      x: 0.85, y: 0.9, width: 0.06, height: 0.06,
      stops: [
        { x: 0.85, y: 0.92, at: 0 },
        { x: 0.50, y: 0.67, at: 1.6, travel: 0.8, path: 'arc' },
        // A click can drive another object's state — this is what makes a
        // product demo a demo rather than a slideshow.
        { x: 0.50, y: 0.67, at: 1.9, action: 'click',
          targetId: 'button-1', targetState: 'success' },
      ],
    },
    {
      id: 'tick-1',
      type: 'icon',
      icon: 'check',
      x: 0.455, y: 0.76, width: 0.09, height: 0.09,
      color: ACCENT,
      motion: { enter: 'draw-in', speed: 'fast' },
      start: 2.1,
    },
  ];

  return [
    // 1 — the smallest useful scene.
    blankScene({
      duration: 1.2,
      text: 'the simplest scene',
      style: 'punch',
      background: 'green',
    }),

    // 2 — typography with composition and hierarchy.
    blankScene({
      duration: 2,
      text: "YOU DON'T NEED\nMORE\nfollowers.",
      case: 'as-typed',
      background: 'cream',
      style: 'massive',
      composition: 'split',
      visualStyle: 'solid',
      elements: [
        element("YOU DON'T NEED", { role: 'secondary', position: 'top-left', animation: 'slide' }),
        element('MORE', { role: 'emphasis', size: 'oversized', position: 'center',
                          animation: 'massive', visualStyle: 'gradient' }),
        element('followers.', { role: 'support', position: 'bottom-right',
                                animation: 'punch', delay: 0.14 }),
      ],
    }),

    // 3 — motion graphics: card, button, cursor, icon, a state change.
    blankScene({
      duration: 3,
      text: 'ONE TAP',
      case: 'as-typed',
      background: 'black',
      style: 'punch',
      composition: 'top-statement',
      elements: [element('ONE TAP', { role: 'secondary', animation: 'punch' })],
      objects: uiObjects,
    }),

    // 4 — the close, back on pure typography.
    blankScene({
      duration: 1.8,
      text: 'DONE.',
      case: 'as-typed',
      background: 'green',
      style: 'massive',
      composition: 'oversized-center',
      elements: [element('DONE.', { role: 'emphasis', size: 'oversized', animation: 'massive' })],
    }),
  ];
};

/**
 * The sample, as the engine itself would write it.
 *
 * Built fresh on each call because `blankScene`/`element` mint new ids — which
 * also means the ids in the copied text are examples, not fixtures.
 */
export const sampleProjectJson = (): string =>
  serialiseProject(sampleScenes(), 'Sample project', {}, null, 'portrait', {
    /*
     * V7 — shown so the shape of an audio track is part of the example, with a
     * placeholder path rather than a real upload.
     *
     * The path is deliberately one that will not resolve: nothing ships an
     * audio asset, and pointing at a machine-specific `uploads/…` hash would be
     * worse — it would work on exactly one computer. Importing this sample
     * therefore also demonstrates the missing-asset state, which is a real
     * thing users hit when a project moves between machines. The video still
     * renders; only the sound is absent, and the editor says so.
     */
    src: 'uploads/your-track.mp3',
    name: 'your-track.mp3',
    sourceDuration: 180,
    sourceStart: 88.2,
    sourceEnd: 107.6,
    timelineStart: 0,
    volume: 0.9,
    fadeIn: 0.5,
    fadeOut: 1,
  });
