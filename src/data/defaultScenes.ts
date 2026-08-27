/**
 * The demo reel the app opens with.
 *
 * Built in the spirit of `reference/Video-48028.mp4` rather than as a copy of
 * it: same palette, same tight lowercase grotesk, same accelerating rhythm
 * (0.85s at the head down to 0.3s at the tail), and it exercises all five
 * motion styles. Durations are ordinary numbers — nothing about 7 seconds is
 * baked into the engine.
 */

import type { Scene, SceneElement } from '../types/scene';

let counter = 0;

export const makeSceneId = (): string => {
  counter += 1;
  return `scene-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export const makeElementId = (): string => {
  counter += 1;
  return `el-${Date.now().toString(36)}-${counter.toString(36)}`;
};

/**
 * A V3 text element. Only the text is required — role supplies a size, the
 * scene's composition supplies a position, the scene supplies an animation.
 */
export const element = (
  text: string,
  overrides: Partial<Omit<SceneElement, 'id' | 'text'>> = {},
): SceneElement => ({
  id: makeElementId(),
  text,
  ...overrides,
});

/** A blank element, for the editor's "add element" button. */
export const blankElement = (text = 'new line'): SceneElement =>
  element(text, { role: 'primary' });

export const blankScene = (overrides: Partial<Scene> = {}): Scene => ({
  id: makeSceneId(),
  duration: 0.8,
  text: 'new scene',
  style: 'punch',
  background: 'cream',
  alignment: 'center',
  emphasis: [],
  fontSize: 1,
  case: 'lower',
  ...overrides,
});

export const defaultScenes = (): Scene[] => [
  blankScene({
    duration: 0.85,
    text: 'the only',
    style: 'slide',
    direction: 'bottom',
    background: 'cream',
    emphasis: ['only'],
  }),
  blankScene({
    duration: 0.75,
    text: 'comparison worth making',
    style: 'punch',
    background: 'green',
    emphasis: ['comparison'],
  }),
  blankScene({
    duration: 0.6,
    text: 'is who you',
    style: 'slide',
    direction: 'top',
    background: 'cream',
    emphasis: ['you'],
  }),
  blankScene({
    duration: 0.65,
    text: 'were',
    style: 'massive',
    background: 'green',
  }),
  blankScene({
    duration: 0.6,
    text: 'yesterday',
    style: 'punch',
    background: 'cream',
  }),
  blankScene({
    duration: 0.5,
    text: 'everything',
    style: 'slide',
    direction: 'top',
    background: 'green',
  }),
  blankScene({
    duration: 1.9,
    text: 'else\nis\na\nrace\nyou',
    style: 'rapid',
    background: 'cream',
    emphasis: ['you'],
    flipBackground: true,
  }),
  blankScene({
    duration: 0.7,
    text: 'were never',
    style: 'stack',
    background: 'green',
    emphasis: ['never'],
    flipBackground: true,
  }),
  blankScene({
    duration: 0.9,
    text: 'meant to run',
    style: 'stack',
    background: 'cream',
    emphasis: ['run'],
    flipBackground: true,
  }),
];
