/**
 * Length presets.
 *
 * These exist to prove the point of the architecture: the same five styles and
 * the same composition produce a 5-second cut and a 30-second cut with no code
 * change. Loading one just replaces the scene list.
 */

import type { Scene, SceneElement } from '../types/scene';
import { blankScene, defaultScenes, element } from './defaultScenes';
import { v6Mixed, v6Objects } from './v6Demos';

export type Preset = {
  id: string;
  label: string;
  note: string;
  build: () => Scene[];
};

const s = blankScene;

const fiveSecond = (): Scene[] => [
  s({ duration: 0.9, text: 'people', style: 'slide', direction: 'bottom', background: 'cream' }),
  s({ duration: 0.7, text: "don't buy", style: 'punch', background: 'green', emphasis: ['buy'] }),
  s({ duration: 1.2, text: 'websites', style: 'massive', background: 'cream' }),
  s({ duration: 0.8, text: 'they buy', style: 'slide', direction: 'top', background: 'green', emphasis: ['buy'] }),
  s({ duration: 1.4, text: 'certainty', style: 'punch', background: 'cream' }),
];

const eightSecond = (): Scene[] => [
  s({ duration: 1, text: 'we build', style: 'slide', direction: 'bottom', background: 'green', emphasis: ['build'] }),
  s({ duration: 0.7, text: 'brands that', style: 'punch', background: 'cream', emphasis: ['brands'] }),
  s({ duration: 1.1, text: 'move', style: 'massive', background: 'green' }),
  s({ duration: 1.6, text: 'ai.\ndesign.\nwebsites.\ncontent.', style: 'rapid', background: 'cream', flipBackground: true }),
  s({ duration: 0.8, text: 'one studio', style: 'slide', direction: 'right', background: 'green', emphasis: ['one'] }),
  s({ duration: 1.1, text: 'no excuses', style: 'stack', background: 'cream', emphasis: ['excuses'], flipBackground: true }),
  s({ duration: 1.7, text: 'flarent', style: 'massive', background: 'green' }),
];

const nineteenSecond = (): Scene[] => [
  ...defaultScenes(),
  s({ duration: 1, text: 'so we', style: 'slide', direction: 'bottom', background: 'green', emphasis: ['so'] }),
  s({ duration: 0.9, text: 'stopped', style: 'punch', background: 'cream' }),
  s({ duration: 1.3, text: 'measuring', style: 'massive', background: 'green' }),
  s({ duration: 2.6, text: 'the noise.\nthe metrics.\nthe others.\nthe timeline.', style: 'rapid', background: 'cream', flipBackground: true }),
  s({ duration: 1.1, text: 'and started', style: 'slide', direction: 'left', background: 'green', emphasis: ['started'] }),
  s({ duration: 1.4, text: 'making things', style: 'stack', background: 'cream', emphasis: ['making'], flipBackground: true }),
  s({ duration: 1.2, text: 'that last', style: 'punch', background: 'green', emphasis: ['last'] }),
  s({ duration: 2, text: 'flarent', style: 'massive', background: 'cream' }),
];

const thirtySecond = (): Scene[] => [
  s({ duration: 1.2, text: 'every studio', style: 'slide', direction: 'bottom', background: 'cream', emphasis: ['every'] }),
  s({ duration: 1, text: 'says the', style: 'punch', background: 'green', emphasis: ['says'] }),
  s({ duration: 1.5, text: 'same', style: 'massive', background: 'cream' }),
  s({ duration: 0.9, text: 'thing', style: 'punch', background: 'green' }),
  s({ duration: 2.8, text: 'strategy.\nbranding.\nwebsites.\ncontent.\nmarketing.', style: 'rapid', background: 'cream', flipBackground: true }),
  s({ duration: 1.3, text: 'nobody says', style: 'slide', direction: 'top', background: 'green', emphasis: ['nobody'] }),
  s({ duration: 1.6, text: 'what it costs', style: 'stack', background: 'cream', emphasis: ['costs'], flipBackground: true }),
  s({ duration: 1, text: 'to be', style: 'punch', background: 'green' }),
  s({ duration: 1.7, text: 'ordinary', style: 'massive', background: 'cream' }),
  s({ duration: 1.1, text: 'attention', style: 'slide', direction: 'right', background: 'green' }),
  s({ duration: 1, text: 'is the only', style: 'punch', background: 'cream', emphasis: ['only'] }),
  s({ duration: 1.4, text: 'currency', style: 'massive', background: 'green' }),
  s({ duration: 2.4, text: 'earn it.\nkeep it.\nspend it well.', style: 'rapid', background: 'cream', flipBackground: true }),
  s({ duration: 1.5, text: 'we make work', style: 'stack', background: 'green', emphasis: ['work'], flipBackground: true }),
  s({ duration: 1.2, text: 'people finish', style: 'punch', background: 'cream', emphasis: ['finish'] }),
  s({ duration: 0.9, text: 'and then', style: 'slide', direction: 'bottom', background: 'green' }),
  s({ duration: 1.6, text: 'share', style: 'massive', background: 'cream' }),
  s({ duration: 1.2, text: 'no filler', style: 'stack', background: 'green', emphasis: ['filler'], flipBackground: true }),
  s({ duration: 1, text: 'no waiting', style: 'punch', background: 'cream', emphasis: ['waiting'] }),
  s({ duration: 1.4, text: 'no excuses', style: 'stack', background: 'green', emphasis: ['excuses'], flipBackground: true }),
  s({ duration: 2.3, text: 'flarent', style: 'massive', background: 'cream' }),
];

/**
 * V2 motion test — the reel to watch when judging transition quality.
 *
 * Every scene shares a word with the one before it, so the seams show word
 * continuity rather than replacement: "YOU HAVE" stays put while "THE IDEA."
 * arrives, "BUILDING" travels from hero to support line, "DIFFERENT." is handed
 * from a STACK build straight into a MASSIVE scale. All five styles appear, and
 * the field cuts twice so both kinds of seam are represented.
 */
const v2MotionTest = (): Scene[] => [
  s({ duration: 1, text: 'YOU HAVE', style: 'slide', direction: 'bottom', background: 'green', emphasis: ['HAVE'], case: 'as-typed' }),
  s({ duration: 1.5, text: 'YOU HAVE THE IDEA.', style: 'punch', background: 'green', emphasis: ['IDEA.'], case: 'as-typed' }),
  s({ duration: 1.1, text: 'BUT BUILDING', style: 'slide', direction: 'left', background: 'cream', emphasis: ['BUILDING'], case: 'as-typed' }),
  s({ duration: 1.5, text: 'BUILDING A BUSINESS', style: 'punch', background: 'cream', emphasis: ['BUSINESS'], case: 'as-typed' }),
  s({ duration: 0.7, text: 'IS', style: 'punch', background: 'green', case: 'as-typed' }),
  s({ duration: 1.2, text: 'IS DIFFERENT.', style: 'stack', background: 'green', emphasis: ['DIFFERENT.'], case: 'as-typed' }),
  s({ duration: 2, text: 'DIFFERENT.', style: 'massive', background: 'green', case: 'as-typed' }),
];

/** The same transitions held across a longer composition. */
const v2LongTest = (): Scene[] => [
  s({ duration: 1.2, text: 'YOU HAVE', style: 'slide', direction: 'bottom', background: 'green', emphasis: ['HAVE'], case: 'as-typed' }),
  s({ duration: 1.7, text: 'YOU HAVE THE IDEA.', style: 'punch', background: 'green', emphasis: ['IDEA.'], case: 'as-typed' }),
  s({ duration: 1.7, text: 'YOU HAVE THE WEBSITE.', style: 'punch', background: 'green', emphasis: ['WEBSITE.'], case: 'as-typed' }),
  s({ duration: 1.7, text: 'YOU HAVE THE LOGO.', style: 'punch', background: 'green', emphasis: ['LOGO.'], case: 'as-typed' }),
  s({ duration: 1.9, text: 'YOU HAVE THE PRODUCT.', style: 'punch', background: 'green', emphasis: ['PRODUCT.'], case: 'as-typed' }),
  s({ duration: 1.3, text: 'BUT NONE', style: 'slide', direction: 'left', background: 'cream', emphasis: ['NONE'], case: 'as-typed' }),
  s({ duration: 1.5, text: 'NONE OF THAT', style: 'stack', background: 'cream', emphasis: ['THAT'], case: 'as-typed' }),
  s({ duration: 1.3, text: 'THAT MATTERS', style: 'slide', direction: 'bottom', background: 'cream', emphasis: ['MATTERS'], case: 'as-typed' }),
  s({ duration: 2, text: 'MATTERS', style: 'massive', background: 'green', case: 'as-typed' }),
  s({ duration: 1.4, text: 'IF NOBODY', style: 'slide', direction: 'right', background: 'cream', emphasis: ['NOBODY'], case: 'as-typed' }),
  s({ duration: 2.3, text: 'NOBODY BUYS.', style: 'massive', background: 'green', emphasis: ['BUYS.'], case: 'as-typed' }),
];

/* ------------------------------------------------------------------- V3 */

/**
 * V3 demo — composition, hierarchy and oversized type on the brief's own script.
 *
 * The point of this reel is the **pause test**: stop it anywhere and the frame
 * should read as a designed composition rather than as a caption waiting for
 * the next word. So almost nothing here is centred, the scale contrast between
 * roles is wide, and three of the nine scenes let the type run off the frame.
 *
 * It also keeps every V2 behaviour visible: "YOU HAVE" and "YOU NEED" survive
 * their scene changes as carried words, the field cuts twice, and all five
 * animation styles appear — now operating inside compositions rather than each
 * owning the whole frame.
 */
const v3Demo = (): Scene[] => [
  // One line, high in the frame, deliberately small. The air below it is the
  // composition — this frame is mostly empty and is supposed to be.
  s({
    duration: 1,
    text: 'YOU HAVE',
    case: 'as-typed',
    background: 'green',
    composition: 'top-statement',
    elements: [element('YOU HAVE', { role: 'secondary', animation: 'slide' })],
  }),
  // The payoff arrives under the line already on screen. "YOU HAVE" is carried
  // across the seam rather than re-entering.
  s({
    duration: 1.6,
    text: 'YOU HAVE\nTHE IDEA.',
    case: 'as-typed',
    background: 'green',
    composition: 'left-stack',
    elements: [
      element('YOU HAVE', { role: 'secondary', animation: 'slide' }),
      element('THE IDEA.', { role: 'emphasis', size: 'huge', animation: 'punch' }),
    ],
  }),
  // SPLIT: two phrases thrown to opposite margins, with real air between them.
  s({
    duration: 1.5,
    text: 'BUT BUILDING\nA BUSINESS',
    case: 'as-typed',
    background: 'cream',
    composition: 'split',
    elements: [
      element('BUT BUILDING', { role: 'secondary', animation: 'slide' }),
      element('A BUSINESS', {
        role: 'primary',
        animation: 'punch',
        delay: 0.1,
      }),
    ],
  }),
  // Oversized: the word exceeds the frame and is cropped by it. A two-letter
  // SUPPORT word in the corner is all that keeps the frame from being one shape.
  s({
    duration: 2,
    text: 'IS\nDIFFERENT.',
    case: 'as-typed',
    background: 'green',
    composition: 'oversized-center',
    elements: [
      element('IS', { role: 'support', position: 'top-left', animation: 'punch' }),
      element('DIFFERENT.', {
        role: 'emphasis',
        size: 'oversized',
        animation: 'massive',
        delay: 0.06,
      }),
    ],
  }),
  s({
    duration: 1.1,
    text: "YOU DON'T NEED",
    case: 'as-typed',
    background: 'cream',
    composition: 'bottom-statement',
    elements: [
      element("YOU DON'T NEED", { role: 'secondary', animation: 'slide' }),
    ],
  }),
  // The brief's canonical hierarchy example, positioned exactly as its own JSON
  // sample does: three elements, three roles, three corners of the frame.
  s({
    duration: 2,
    text: "YOU DON'T NEED\nMORE\nfollowers.",
    case: 'as-typed',
    background: 'cream',
    composition: 'split',
    elements: [
      element("YOU DON'T NEED", {
        role: 'secondary',
        position: 'top-left',
        animation: 'slide',
      }),
      element('MORE', {
        role: 'emphasis',
        size: 'oversized',
        position: 'center',
        animation: 'massive',
      }),
      element('followers.', {
        role: 'support',
        position: 'bottom-right',
        animation: 'punch',
        delay: 0.14,
      }),
    ],
  }),
  // RAPID inside a composition: the beats cut against the field while a SUPPORT
  // line holds the corner through all of them.
  s({
    duration: 1.8,
    text: 'MORE LIKES.\nMORE REACH.\nMORE FOLLOWERS.',
    case: 'as-typed',
    background: 'cream',
    flipBackground: true,
    composition: 'center',
    elements: [
      element('MORE LIKES.\nMORE REACH.\nMORE FOLLOWERS.', {
        role: 'primary',
        animation: 'rapid',
      }),
    ],
  }),
  s({
    duration: 1,
    text: 'YOU NEED',
    case: 'as-typed',
    background: 'green',
    composition: 'top-statement',
    elements: [element('YOU NEED', { role: 'secondary', animation: 'slide' })],
  }),
  // The close. CUSTOMERS. runs past both edges; "YOU NEED" is carried in from
  // the scene before and settles above it.
  s({
    duration: 2.4,
    text: 'YOU NEED\nCUSTOMERS.',
    case: 'as-typed',
    background: 'green',
    composition: 'oversized-center',
    elements: [
      element('YOU NEED', {
        role: 'secondary',
        position: 'top-left',
        animation: 'slide',
      }),
      element('CUSTOMERS.', {
        role: 'emphasis',
        size: 'oversized',
        animation: 'massive',
      }),
    ],
  }),
];

/**
 * V3 hierarchy test — the same three words in one frame, nothing else.
 *
 * Four takes on one sentence so the role system can be judged rather than
 * described: the difference between SECONDARY, EMPHASIS and SUPPORT should be
 * unmistakable at a glance, and each composition should move all three without
 * either of the small pieces competing with the big one.
 */
const v3Hierarchy = (): Scene[] => {
  const three = (
    positions: [
      SceneElement['position'],
      SceneElement['position'],
      SceneElement['position'],
    ],
  ): SceneElement[] => [
    element("You don't need", {
      role: 'secondary',
      position: positions[0],
      animation: 'slide',
    }),
    element('MORE', {
      role: 'emphasis',
      size: 'oversized',
      position: positions[1],
      animation: 'massive',
    }),
    element('followers.', {
      role: 'support',
      position: positions[2],
      animation: 'punch',
      delay: 0.12,
    }),
  ];

  return [
    s({
      duration: 2.2,
      text: "You don't need\nMORE\nfollowers.",
      case: 'as-typed',
      background: 'green',
      composition: 'split',
      elements: three(['top-left', 'center', 'bottom-right']),
    }),
    s({
      duration: 2.2,
      text: "You don't need\nMORE\nfollowers.",
      case: 'as-typed',
      background: 'cream',
      composition: 'left-stack',
      elements: three([undefined, undefined, undefined]),
    }),
    s({
      duration: 2.2,
      text: "You don't need\nMORE\nfollowers.",
      case: 'as-typed',
      background: 'green',
      composition: 'corner',
      elements: three([undefined, undefined, undefined]),
    }),
    s({
      duration: 2.4,
      text: "You don't need\nMORE\nfollowers.",
      case: 'as-typed',
      background: 'cream',
      composition: 'oversized-center',
      elements: three([undefined, undefined, undefined]),
    }),
  ];
};

/**
 * V3 oversized test — one word per scene, at every step of the scale.
 *
 * Watch the crop, not the movement: LARGE fits, HUGE touches the edges,
 * OVERSIZED is cut by them, and the two EDGE scenes hang the word off one side
 * on purpose. If any of these quietly shrank to fit, the auto-fit policy is
 * wrong.
 */
const v3Oversized = (): Scene[] => [
  s({
    duration: 1.2,
    text: 'CUSTOMERS',
    case: 'as-typed',
    background: 'green',
    composition: 'center',
    elements: [element('CUSTOMERS', { role: 'primary', size: 'large', animation: 'punch' })],
  }),
  s({
    duration: 1.2,
    text: 'CUSTOMERS',
    case: 'as-typed',
    background: 'cream',
    composition: 'center',
    elements: [element('CUSTOMERS', { role: 'emphasis', size: 'huge', animation: 'punch' })],
  }),
  s({
    duration: 1.6,
    text: 'CUSTOMERS',
    case: 'as-typed',
    background: 'green',
    composition: 'oversized-center',
    elements: [
      element('CUSTOMERS', { role: 'emphasis', size: 'oversized', animation: 'massive' }),
    ],
  }),
  s({
    duration: 1.4,
    text: 'CUSTOMERS',
    case: 'as-typed',
    background: 'cream',
    composition: 'center',
    elements: [
      element('CUSTOMERS', {
        role: 'emphasis',
        size: 'huge',
        position: 'edge-right',
        animation: 'slide',
      }),
    ],
  }),
  s({
    duration: 1.8,
    text: 'MORE\nCUSTOMERS',
    case: 'as-typed',
    background: 'green',
    composition: 'left-stack',
    elements: [
      element('MORE', { role: 'secondary', animation: 'slide' }),
      element('CUSTOMERS', {
        role: 'emphasis',
        size: 'oversized',
        position: 'edge-left',
        animation: 'massive',
        delay: 0.08,
      }),
    ],
  }),
];

/**
 * V3 long composition — 19 seconds, ten scenes, every composition preset.
 *
 * The question this answers is whether the system holds up over a real reel
 * rather than over a demo frame: does the hierarchy stay legible, do the
 * seams still carry words across, and does anything drift once thirty
 * elements have been placed.
 */
const v3Long = (): Scene[] => [
  s({
    duration: 1.8,
    text: 'EVERY STUDIO\nSAYS THE SAME THING',
    case: 'as-typed',
    background: 'cream',
    composition: 'top-statement',
    elements: [
      element('EVERY STUDIO', { role: 'secondary', animation: 'slide' }),
      element('SAYS THE SAME THING', { role: 'primary', animation: 'punch', delay: 0.1 }),
    ],
  }),
  s({
    duration: 1.9,
    text: 'STRATEGY.\nBRANDING.\nWEBSITES.\nCONTENT.',
    case: 'as-typed',
    background: 'cream',
    flipBackground: true,
    composition: 'center',
    elements: [
      element('STRATEGY.\nBRANDING.\nWEBSITES.\nCONTENT.', {
        role: 'primary',
        animation: 'rapid',
      }),
    ],
  }),
  s({
    duration: 1.7,
    text: 'NOBODY SAYS\nWHAT IT COSTS',
    case: 'as-typed',
    background: 'green',
    composition: 'split',
    elements: [
      element('NOBODY SAYS', { role: 'secondary', animation: 'slide' }),
      element('WHAT IT COSTS', { role: 'primary', animation: 'stack', delay: 0.08 }),
    ],
  }),
  s({
    duration: 2,
    text: 'TO BE\nORDINARY',
    case: 'as-typed',
    background: 'green',
    composition: 'oversized-center',
    elements: [
      element('TO BE', { role: 'support', position: 'top-left', animation: 'punch' }),
      element('ORDINARY', {
        role: 'emphasis',
        size: 'oversized',
        animation: 'massive',
        delay: 0.06,
      }),
    ],
  }),
  s({
    duration: 1.6,
    text: 'ATTENTION\nis the only',
    case: 'as-typed',
    background: 'cream',
    composition: 'corner',
    elements: [
      element('ATTENTION', { role: 'primary', animation: 'slide' }),
      element('is the only', { role: 'support', animation: 'punch', delay: 0.12 }),
    ],
  }),
  s({
    duration: 2,
    text: 'CURRENCY',
    case: 'as-typed',
    background: 'green',
    composition: 'center',
    elements: [
      element('CURRENCY', {
        role: 'emphasis',
        size: 'oversized',
        animation: 'massive',
      }),
    ],
  }),
  s({
    duration: 1.7,
    text: 'EARN IT.\nKEEP IT.\nSPEND IT WELL.',
    case: 'as-typed',
    background: 'cream',
    composition: 'right-stack',
    elements: [
      element('EARN IT.', { role: 'secondary', animation: 'slide' }),
      element('KEEP IT.', { role: 'secondary', animation: 'slide', delay: 0.1 }),
      element('SPEND IT WELL.', { role: 'primary', animation: 'punch', delay: 0.2 }),
    ],
  }),
  s({
    duration: 1.8,
    text: 'WE MAKE WORK\nPEOPLE FINISH',
    case: 'as-typed',
    background: 'green',
    composition: 'bottom-statement',
    elements: [
      element('WE MAKE WORK', { role: 'secondary', animation: 'slide' }),
      element('PEOPLE FINISH', { role: 'primary', animation: 'stack', delay: 0.08 }),
    ],
  }),
  s({
    duration: 1.5,
    text: 'AND THEN\nSHARE',
    case: 'as-typed',
    background: 'cream',
    composition: 'left-stack',
    elements: [
      element('AND THEN', { role: 'support', animation: 'slide' }),
      element('SHARE', { role: 'emphasis', size: 'huge', animation: 'punch', delay: 0.1 }),
    ],
  }),
  s({
    duration: 3,
    text: 'FLARENT',
    case: 'as-typed',
    background: 'green',
    composition: 'oversized-center',
    elements: [
      element('FLARENT', {
        role: 'emphasis',
        size: 'oversized',
        animation: 'massive',
      }),
    ],
  }),
];

/* ------------------------------------------------------------------- V4 */

/**
 * V4 style test — one word, one animation, four visual styles.
 *
 * Everything except the style is held constant on purpose: if these five scenes
 * differ in any way other than how the type is *painted*, the separation between
 * animation and style has leaked somewhere. It is the reel to render when
 * checking that gradients and strokes survive the export.
 */
const v4Styles = (): Scene[] => [
  s({
    duration: 1.2, text: 'CUSTOMERS', case: 'as-typed', background: 'cream',
    style: 'punch', composition: 'center', visualStyle: 'solid',
    elements: [element('CUSTOMERS', { role: 'primary' })],
  }),
  s({
    duration: 1.2, text: 'CUSTOMERS', case: 'as-typed', background: 'green',
    style: 'punch', composition: 'center', visualStyle: 'outline',
    elements: [element('CUSTOMERS', { role: 'primary' })],
  }),
  s({
    duration: 1.2, text: 'CUSTOMERS', case: 'as-typed', background: 'green',
    style: 'punch', composition: 'center', visualStyle: 'gradient',
    elements: [element('CUSTOMERS', { role: 'primary' })],
  }),
  s({
    duration: 1.2, text: 'MORE CUSTOMERS', case: 'as-typed', background: 'green',
    style: 'punch', composition: 'center', visualStyle: 'split',
    elements: [element('MORE CUSTOMERS', { role: 'primary' })],
  }),
  s({
    duration: 1.6, text: 'CUSTOMERS', case: 'as-typed', background: 'green',
    style: 'massive', composition: 'oversized-center', visualStyle: 'gradient',
    elements: [element('CUSTOMERS', { role: 'emphasis', size: 'oversized' })],
  }),
];

/**
 * V4 dynamic demo — one word, cycling treatments.
 *
 * The point the reference makes, reduced to its smallest form: the typography
 * does not hold one treatment for the whole film. Same word, same engine, five
 * different visual characters — and the animation varies independently, which
 * is what proves the two systems are not coupled.
 */
const v4Dynamic = (): Scene[] => [
  s({
    duration: 1, text: 'DYNAMIC', case: 'as-typed', background: 'cream',
    style: 'slide', direction: 'bottom', composition: 'center', visualStyle: 'solid',
    styleConfig: { type: 'solid', fillColor: 'blue' },
    elements: [element('DYNAMIC', { role: 'primary' })],
  }),
  s({
    duration: 1.1, text: 'DYNAMIC', case: 'as-typed', background: 'green',
    style: 'stack', composition: 'center', visualStyle: 'outline',
    elements: [element('DYNAMIC', { role: 'primary' })],
  }),
  s({
    duration: 1.3, text: 'DYNAMIC', case: 'as-typed', background: 'green',
    style: 'punch', composition: 'center', visualStyle: 'gradient',
    elements: [element('DYNAMIC', { role: 'emphasis', size: 'huge' })],
  }),
  s({
    duration: 1.3, text: 'DYNAMIC', case: 'as-typed', background: 'green',
    style: 'slide', direction: 'left', composition: 'center', visualStyle: 'split',
    elements: [element('DYNAMIC', { role: 'primary', size: 'large' })],
  }),
  s({
    duration: 2, text: 'DYNAMIC', case: 'as-typed', background: 'green',
    style: 'massive', composition: 'oversized-center', visualStyle: 'gradient',
    elements: [element('DYNAMIC', { role: 'emphasis', size: 'oversized' })],
  }),
];

/**
 * V4 reel — the V3 narration, now with style rhythm.
 *
 * Style is not switched every scene for its own sake. SOLID carries the setup,
 * OUTLINE takes the quieter beat that sets up a loud one, and GRADIENT is
 * reserved for the two moments that matter — DIFFERENT. and CUSTOMERS. Four
 * gradients in nine scenes would spend the effect before the ending needs it.
 */
const v4Reel = (): Scene[] => [
  s({
    duration: 1, text: 'YOU HAVE', case: 'as-typed', background: 'green',
    style: 'slide', composition: 'top-statement', visualStyle: 'solid',
    elements: [element('YOU HAVE', { role: 'secondary', animation: 'slide' })],
  }),
  s({
    duration: 1.6, text: 'YOU HAVE\nTHE IDEA.', case: 'as-typed', background: 'green',
    style: 'punch', composition: 'left-stack', visualStyle: 'solid',
    elements: [
      element('YOU HAVE', { role: 'secondary', animation: 'slide' }),
      element('THE IDEA.', { role: 'emphasis', size: 'huge', animation: 'punch' }),
    ],
  }),
  // The turn in the argument — outline is the quieter, cooler treatment.
  s({
    duration: 1.5, text: 'BUT BUILDING\nA BUSINESS', case: 'as-typed', background: 'cream',
    style: 'slide', composition: 'split', visualStyle: 'outline',
    elements: [
      element('BUT BUILDING', { role: 'secondary', animation: 'slide' }),
      element('A BUSINESS', { role: 'primary', animation: 'punch', delay: 0.1 }),
    ],
  }),
  // First payoff. GRADIENT, oversized, cropped by the frame.
  s({
    duration: 2, text: 'IS\nDIFFERENT.', case: 'as-typed', background: 'green',
    style: 'massive', composition: 'oversized-center', visualStyle: 'gradient',
    elements: [
      element('IS', { role: 'support', position: 'top-left', animation: 'punch',
                      visualStyle: 'solid' }),
      element('DIFFERENT.', { role: 'emphasis', size: 'oversized', animation: 'massive',
                              delay: 0.06 }),
    ],
  }),
  s({
    duration: 1.1, text: "YOU DON'T NEED", case: 'as-typed', background: 'cream',
    style: 'slide', composition: 'bottom-statement', visualStyle: 'outline',
    elements: [element("YOU DON'T NEED", { role: 'secondary', animation: 'slide' })],
  }),
  // Three roles, three styles — the inheritance case, with two overrides.
  s({
    duration: 2, text: "YOU DON'T NEED\nMORE\nfollowers.", case: 'as-typed',
    background: 'cream', style: 'massive', composition: 'split', visualStyle: 'solid',
    elements: [
      element("YOU DON'T NEED", { role: 'secondary', position: 'top-left',
                                  animation: 'slide' }),
      element('MORE', { role: 'emphasis', size: 'oversized', position: 'center',
                        animation: 'massive', visualStyle: 'gradient' }),
      element('followers.', { role: 'support', position: 'bottom-right',
                              animation: 'punch', delay: 0.14,
                              visualStyle: 'outline' }),
    ],
  }),
  s({
    duration: 1.8, text: 'MORE LIKES.\nMORE REACH.\nMORE FOLLOWERS.', case: 'as-typed',
    background: 'cream', flipBackground: true, style: 'rapid',
    composition: 'center', visualStyle: 'solid',
    elements: [element('MORE LIKES.\nMORE REACH.\nMORE FOLLOWERS.',
                       { role: 'primary', animation: 'rapid' })],
  }),
  s({
    duration: 1, text: 'YOU NEED', case: 'as-typed', background: 'green',
    style: 'slide', composition: 'top-statement', visualStyle: 'solid',
    elements: [element('YOU NEED', { role: 'secondary', animation: 'slide' })],
  }),
  // The ending. The second and last gradient in the reel.
  s({
    duration: 2.4, text: 'YOU NEED\nCUSTOMERS.', case: 'as-typed', background: 'green',
    style: 'massive', composition: 'oversized-center', visualStyle: 'gradient',
    elements: [
      element('YOU NEED', { role: 'secondary', position: 'top-left', animation: 'slide',
                            visualStyle: 'solid' }),
      element('CUSTOMERS.', { role: 'emphasis', size: 'oversized', animation: 'massive' }),
    ],
  }),
];

export const PRESETS: Preset[] = [
  {
    id: 'v6-mixed',
    label: 'V6 typography + motion graphics',
    note: '4 scenes · card, button, cursor, icon — with kinetic type',
    build: v6Mixed,
  },
  {
    id: 'v6-objects',
    label: 'V6 object catalogue',
    note: 'every object kind and entrance, one frame',
    build: v6Objects,
  },
  {
    id: 'v4-dynamic',
    label: 'V4 dynamic styles',
    note: '5 scenes \u00b7 one word, five treatments',
    build: v4Dynamic,
  },
  {
    id: 'v4-reel',
    label: 'V4 reel',
    note: '9 scenes \u00b7 14.4s \u00b7 style rhythm',
    build: v4Reel,
  },
  {
    id: 'v4-styles',
    label: 'V4 style test',
    note: '5 scenes \u00b7 solid / outline / gradient / split',
    build: v4Styles,
  },
  {
    id: 'v3',
    label: 'V3 composition demo',
    note: '9 scenes · 14.4s · hierarchy + oversized',
    build: v3Demo,
  },
  {
    id: 'v3-hierarchy',
    label: 'V3 hierarchy test',
    note: '4 scenes · one sentence, four compositions',
    build: v3Hierarchy,
  },
  {
    id: 'v3-oversized',
    label: 'V3 oversized test',
    note: '5 scenes · LARGE → HUGE → OVERSIZED → edges',
    build: v3Oversized,
  },
  {
    id: 'v3-long',
    label: 'V3 long composition',
    note: '10 scenes · 19s · every composition',
    build: v3Long,
  },
  {
    id: 'reference',
    label: 'Reference reel',
    note: '9 scenes · all five styles',
    build: defaultScenes,
  },
  {
    id: 'v2',
    label: 'V2 motion test',
    note: '7 scenes · 9s · word continuity',
    build: v2MotionTest,
  },
  {
    id: 'v2-long',
    label: 'V2 motion test — long',
    note: '11 scenes · 18s',
    build: v2LongTest,
  },
  { id: '5s', label: '5 second', note: '5 scenes', build: fiveSecond },
  { id: '8s', label: '8 second', note: '7 scenes', build: eightSecond },
  { id: '19s', label: '19 second', note: '17 scenes', build: nineteenSecond },
  { id: '30s', label: '30 second', note: '21 scenes', build: thirtySecond },
];
