/**
 * Type system.
 *
 * Palette and metrics were sampled directly from `reference/Video-48028.mp4`:
 *   background cream  rgb(238,238,238)
 *   background green  rgb(19,88,29)
 *   ink on green      rgb(255,255,255)
 *   ink on cream      rgb(33,78,27)   <- deliberately deeper than the green bg
 *
 * The black · cream pair follows the same logic with Flarent's original ink.
 *
 * Swapping the typeface is a two-step job: drop new .woff2 files into
 * `public/fonts/`, then update FONT_FACES and FONT_METRICS below. Nothing else
 * in the engine references a font name.
 */

import { fitText, measureText } from '@remotion/layout-utils';
import type {
  Alignment,
  BackgroundName,
  PaletteName,
  TextCase,
  TextFit,
} from '../types/scene';
import { CANVAS } from './timing';
import type { VideoConfig } from '../types/scene';

/* ------------------------------------------------------------------ colour */

export type Theme = {
  background: string;
  ink: string;
  /**
   * V8 — the project's accent.
   *
   * Carried on the theme because that is already the object every renderer
   * receives, so an accent needs no new prop threading through five components.
   * Defaults to the house value, which is what every pre-V8 project gets.
   */
  accent: string;
};

/**
 * The house accent — the green the reference uses for its lit states.
 * A project may replace it; nothing may hard-code past it.
 */
export const DEFAULT_ACCENT = '#4ADE6A';

/** Field colours. Green and cream were sampled from the reference. */
export const FIELDS: Record<BackgroundName, string> = {
  green: '#13581D',
  cream: '#EEEEEE',
  // Not pure black: #000 crushes and bands badly under H.264 at these flat
  // full-frame areas, and reads harsher than the cream deserves.
  black: '#0F0F0F',
};

export type PaletteDefinition = {
  id: PaletteName;
  label: string;
  /** The dark half of the pair. Cream is always the light half. */
  dark: BackgroundName;
  /**
   * Ink laid on cream. The reference sets a *deeper* green than its own green
   * field rather than reusing it, so each palette names its own value.
   */
  creamInk: string;
};

export const PALETTES: Record<PaletteName, PaletteDefinition> = {
  forest: {
    id: 'forest',
    label: 'Green · Cream',
    dark: 'green',
    creamInk: '#214E1B',
  },
  ink: {
    id: 'ink',
    label: 'Black · Cream',
    dark: 'black',
    creamInk: '#121212',
  },
};

export const PALETTE_NAMES: PaletteName[] = ['forest', 'ink'];

export const DEFAULT_PALETTE: PaletteName = 'forest';

export const paletteFor = (palette: PaletteName = DEFAULT_PALETTE): PaletteDefinition =>
  PALETTES[palette] ?? PALETTES[DEFAULT_PALETTE];

/**
 * Per-project field colours, e.g. from an imported script's
 * `backgroundPalette`. Missing entries fall back to FIELDS.
 */
export type FieldOverrides = Partial<Record<BackgroundName, string>>;

const channel = (value: number): number =>
  value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

/** WCAG relative luminance. Used only to keep overridden fields readable. */
const luminance = (hex: string): number => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return 0;
  const r = channel(((value >> 16) & 255) / 255);
  const g = channel(((value >> 8) & 255) / 255);
  const b = channel((value & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * Ink that reads on a given field, within a given palette.
 *
 * V8 adds `inkOverrides`. The distinction between the two override maps is
 * worth stating: a *field* override changes the colour of the ground and the
 * ink is then derived to stay readable on it, which is what keeps an imported
 * script legible when it drops in a mid-tone. An *ink* override is the author
 * saying the quiet part explicitly — "white text on this blue" — and is
 * therefore honoured as written, with no contrast substitution.
 *
 * That asymmetry is deliberate. Auto-contrast is a safety net for a value
 * nobody chose; silently overriding a colour someone did choose would make the
 * palette control untrustworthy, and the author can already see the result.
 */
export const themeFor = (
  background: BackgroundName,
  palette: PaletteName = DEFAULT_PALETTE,
  overrides?: FieldOverrides,
  inkOverrides?: FieldOverrides,
  accent: string = DEFAULT_ACCENT,
): Theme => {
  const definition = paletteFor(palette);
  const field = overrides?.[background] ?? FIELDS[background] ?? FIELDS.green;

  const chosen = inkOverrides?.[background];
  if (chosen) return { background: field, ink: chosen, accent };

  const natural =
    background === 'cream'
      ? definition.creamInk
      : background === 'black'
        ? FIELDS.cream
        : '#FFFFFF';

  // The house ink always clears this comfortably. The check only matters when a
  // project overrides a field colour — an imported script that puts a mid-tone
  // in `backgroundPalette` must not silently produce unreadable type.
  if (contrastRatio(field, natural) >= 3) return { background: field, ink: natural, accent };

  const light = '#FFFFFF';
  const dark = '#111111';
  return {
    background: field,
    ink: contrastRatio(field, light) >= contrastRatio(field, dark) ? light : dark,
    accent,
  };
};

/**
 * The other half of the pair. Cream's partner depends on the palette, which is
 * exactly why the palette is project-level and not a per-scene setting.
 */
export const flipBackground = (
  background: BackgroundName,
  palette: PaletteName = DEFAULT_PALETTE,
): BackgroundName =>
  background === 'cream' ? paletteFor(palette).dark : 'cream';

/** The two fields a palette cuts between, dark first. */
export const fieldsOf = (palette: PaletteName = DEFAULT_PALETTE): BackgroundName[] => [
  paletteFor(palette).dark,
  'cream',
];

/** Re-point every scene's dark field when the palette changes. */
export const remapBackground = (
  background: BackgroundName,
  palette: PaletteName,
): BackgroundName => (background === 'cream' ? 'cream' : paletteFor(palette).dark);

/* -------------------------------------------------------------------- font */

/**
 * The family name is internal — the actual files are mapped in utils/fonts.ts.
 * Keeping an engine-owned name means a typeface swap never touches components.
 */
export const FONT_FAMILY = 'Flarent Grotesk';

export const FONT_STACK = `'${FONT_FAMILY}', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

export const FONT_FACES = [
  { weight: 500, file: 'fonts/inter-500.woff2' },
  { weight: 700, file: 'fonts/inter-700.woff2' },
  { weight: 800, file: 'fonts/inter-800.woff2' },
  { weight: 900, file: 'fonts/inter-900.woff2' },
] as const;

export const HERO_WEIGHT = 800;
export const KICKER_WEIGHT = 800;

/**
 * Vertical metrics as a fraction of font-size, for Inter (unitsPerEm 2816).
 * These let us place lines on their *ink* rather than on their line box, which
 * is what gives the reference its tight, deliberate stacking.
 */
export const FONT_METRICS = {
  ascender: 0.96875,
  descender: 0.24148,
  capHeight: 0.72727,
  xHeight: 0.54545,
  /** Depth of g/j/p/q/y below the baseline. */
  overshootDescender: 0.215,
} as const;

/** Baseline offset from the top of a line box rendered with line-height: 1. */
export const BASELINE_FROM_TOP =
  FONT_METRICS.ascender - (FONT_METRICS.ascender + FONT_METRICS.descender - 1) / 2;

const TALL = /[A-Z0-9bdfhijklt!?ÀÁÂÄÅÈÉÊËÌÍÎÏÑÒÓÔÖÙÚÛÜ]/;
const DEEP = /[gjpqy,;]/;

/** Distance from the top of the line box to the topmost ink, in px. */
export const inkTop = (text: string, fontSize: number): number =>
  fontSize *
  (TALL.test(text)
    ? BASELINE_FROM_TOP - FONT_METRICS.capHeight
    : BASELINE_FROM_TOP - FONT_METRICS.xHeight);

/** Distance from the top of the line box to the bottommost ink, in px. */
export const inkBottom = (text: string, fontSize: number): number =>
  fontSize *
  (DEEP.test(text)
    ? BASELINE_FROM_TOP + FONT_METRICS.overshootDescender
    : BASELINE_FROM_TOP);

/* ---------------------------------------------------------------- tracking */

/**
 * Optical tracking. Large display type needs to be pulled tighter than small
 * type — the reference sets its hero words almost touching. Returned in `em`
 * so it survives any font-size change (and so fitText stays exact).
 */
export const trackingFor = (fontSize: number, canvas: VideoConfig = CANVAS): string => {
  const w = canvas.width;
  if (fontSize >= 0.3 * w) return '-0.05em';
  if (fontSize >= 0.18 * w) return '-0.04em';
  if (fontSize >= 0.1 * w) return '-0.032em';
  return '-0.024em';
};

/* ------------------------------------------------------------------ sizing */

/**
 * 8% of frame width, matching the reference at 1080px. A function rather than a
 * baked constant: it is evaluated once at module load in the fixed-CANVAS
 * world, but the engine now plans against whichever format a project chose,
 * so every consumer resolves it against that format's own width.
 */
export const sideMargin = (canvas: VideoConfig = CANVAS): number => 0.08 * canvas.width;
/** Portrait's own margin, for the few call sites that have not been updated. */
export const SIDE_MARGIN = sideMargin(CANVAS);

export type SizingRule = {
  /** Target line width as a multiple of the frame width. >1 lets type bleed. */
  target: number;
  /** Hard ceiling as a multiple of the frame width. */
  max: number;
  /** Floor, so pathological input never disappears. */
  min: number;
  /**
   * Optional second target for short words. A five-letter word cropped by the
   * frame still reads; a twelve-letter one does not. MASSIVE uses this to bleed
   * decisively on short words and stay inside the frame on long ones — a soft
   * 2% clip on every word just looks like a mistake.
   */
  shortTarget?: number;
  shortMaxChars?: number;
};

/**
 * Per-style type scale, calibrated against the reference by rendering the same
 * words and comparing ink widths. Long words land on `target` (the reference
 * fills 80–84% of the frame); short words hit `max`, which is why "were",
 * "never" and "run" all end up on the same size there.
 */
export const SIZING: Record<string, SizingRule> = {
  massive: {
    // 0.94 rather than filling the frame: MASSIVE adds a 2.5% hold drift on
    // top of this, and at 0.97 a long word ends up grazing both edges — which
    // reads as a clipping mistake rather than as the deliberate crop that
    // `shortTarget` gives short words.
    target: 0.94,
    // Height-derived ceiling: 0.40 · H of cap height ÷ 0.727 ≈ 0.98 · W. Long
    // words never reach it (fit-to-width binds first), so it only governs the
    // one- and two-character words — "5", "a", "01" — where filling the width
    // is impossible and the real limit is how tall a glyph may stand.
    max: 0.98,
    min: 0.14,
    shortTarget: 1.08,
    shortMaxChars: 5,
  },
  punch: { target: 0.835, max: 0.345, min: 0.1 },
  stack: { target: 0.82, max: 0.38, min: 0.09 },
  slide: { target: 0.815, max: 0.345, min: 0.1 },
  rapid: { target: 0.835, max: 0.345, min: 0.1 },
};

/** RAPID's non-emphasised beats are set small — 0.19·W in the reference. */
export const rapidBaseSize = (canvas: VideoConfig = CANVAS): number => 0.19 * canvas.width;
export const RAPID_BASE_SIZE = rapidBaseSize(CANVAS);

/**
 * Supporting words track the hero at ~0.265 — but only inside a band. The
 * reference's support line is really a fixed second step in a two-size scale:
 * across five shots it never leaves 0.078–0.105 of the frame width, even when
 * the hero underneath it is half the size it is elsewhere. Scaling it purely
 * off the hero makes the caption vanish under a long word.
 */
export const KICKER_RATIO = 0.265;
export const kickerMin = (canvas: VideoConfig = CANVAS): number => 0.078 * canvas.width;
export const kickerMax = (canvas: VideoConfig = CANVAS): number => 0.105 * canvas.width;
export const KICKER_MIN = kickerMin(CANVAS);
export const KICKER_MAX = kickerMax(CANVAS);

/** Visual gap between a line's ink and the next line's ink, in hero `em`. */
export const LINE_GAP_EM = 0.042;


/* -------------------------------------------------------------- typefaces */

/**
 * V8 — the accent face.
 *
 * Flarent is deliberately a one-typeface engine: a single house grotesk is what
 * gives every reel its family resemblance, and a font picker would quietly turn
 * a motion-design system into a word processor. But professional kinetic
 * typography leans on *one* controlled contrast — a serif italic against the
 * sans — often enough that not having it is a real expressive limit.
 *
 * So this is exactly two faces, named semantically, and no more. There is no
 * arbitrary font loading, no URL, no upload path. The accent stack is built
 * from faces the renderer's headless Chrome already has, so it needs nothing
 * shipped and cannot fail to load mid-render.
 */
export type FontRole = 'primary' | 'accent';

export const ACCENT_FONT_STACK =
  `Georgia, 'Times New Roman', 'Liberation Serif', 'DejaVu Serif', Times, serif`;

export type TypeFace = {
  role: FontRole;
  family: string;
  /** The accent face is italic; that slant is half of what makes it read as a counterpoint. */
  italic: boolean;
};

export const FACES: Record<FontRole, TypeFace> = {
  primary: { role: 'primary', family: FONT_STACK, italic: false },
  accent: { role: 'accent', family: ACCENT_FONT_STACK, italic: true },
};

export const FONT_ROLES: FontRole[] = ['primary', 'accent'];

export const faceFor = (role: FontRole | undefined): TypeFace =>
  FACES[role ?? 'primary'] ?? FACES.primary;

/** Extra CSS a face needs beyond family — currently only the slant. */
export const faceStyles = (face: TypeFace): { fontStyle?: 'italic' } =>
  face.italic ? { fontStyle: 'italic' } : {};

const fitCache = new Map<string, number>();

/**
 * fitText, memoised. Remotion re-renders every frame; measurement is not free.
 *
 * `canvas` only ever affects the result through `trackingFor`'s breakpoints —
 * `withinWidth` is already an absolute px value the caller resolved — but the
 * cache key must still carry it: the same (text, width, weight) can legitimately
 * measure to a different tracking, and so a different size, under a different
 * frame width.
 */
export const fitToWidth = (
  text: string,
  withinWidth: number,
  weight: number = HERO_WEIGHT,
  canvas: VideoConfig = CANVAS,
  /** V8 — measurement must follow the face the text is actually set in. */
  face: TypeFace = FACES.primary,
): number => {
  if (!text.trim()) return 0;
  // The face is part of the key: a serif italic measures wider than the grotesk
  // at the same size, so sharing a cache entry would size accent text wrongly.
  const key = `${text}|${Math.round(withinWidth)}|${weight}|${canvas.width}|${face.role}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;

  const extra = faceStyles(face);

  // Tracking depends on size and size depends on tracking, so solve twice.
  let size = fitText({
    text,
    withinWidth,
    fontFamily: face.family,
    fontWeight: weight,
    letterSpacing: trackingFor(withinWidth * 0.4, canvas),
    additionalStyles: extra,
  }).fontSize;

  size = fitText({
    text,
    withinWidth,
    fontFamily: face.family,
    fontWeight: weight,
    letterSpacing: trackingFor(size, canvas),
    additionalStyles: extra,
  }).fontSize;

  fitCache.set(key, size);
  return size;
};

const widthCache = new Map<string, number>();

export const widthOf = (
  text: string,
  fontSize: number,
  weight: number = HERO_WEIGHT,
  canvas: VideoConfig = CANVAS,
  face: TypeFace = FACES.primary,
): number => {
  if (!text.trim()) return 0;
  const key = `${text}|${Math.round(fontSize * 100)}|${weight}|${canvas.width}|${face.role}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const { width } = measureText({
    text,
    fontFamily: face.family,
    fontSize,
    fontWeight: weight,
    letterSpacing: trackingFor(fontSize, canvas),
    additionalStyles: faceStyles(face),
  });
  widthCache.set(key, width);
  return width;
};

/**
 * The size a hero line wants to be: fill the frame to the style's target, but
 * never exceed the style's ceiling. Short words therefore stay big rather than
 * becoming absurd, and long words shrink to fit — the reference does exactly
 * this (four-letter words all land on the same ceiling size).
 */
export const resolveHeroSize = (
  text: string,
  rule: SizingRule,
  scale = 1,
  /** V3 sets lighter and heavier faces per role; measurement must follow. */
  weight: number = HERO_WEIGHT,
  canvas: VideoConfig = CANVAS,
  face: TypeFace = FACES.primary,
  /**
   * V8 — an exact width wins over the style's target the same way it does in
   * `resolveSize`. A single-block scene reaches this function instead of that
   * one, so without this the scene-level `fit` a caller set was stored, echoed
   * back, and then silently ignored at render.
   */
  fit?: TextFit,
): number => {
  const w = canvas.width;

  // Same contract as resolveSize: no bleed, no ceiling, no floor, and `scale`
  // may shrink fitted text but never grow it past the width it promised.
  if (fit) {
    const width = Math.max(0.05, Math.min(1, fit.maxWidth));
    const exact = fitToWidth(text, width * w, weight, canvas, face);
    return exact * Math.min(1, Math.max(0, scale || 1));
  }

  const short =
    rule.shortTarget !== undefined &&
    text.replace(/\s+/g, '').length <= (rule.shortMaxChars ?? 5);
  const target = short ? (rule.shortTarget as number) : rule.target;
  const fitted = fitToWidth(text, target * w, weight, canvas, face);
  return Math.max(rule.min * w, Math.min(rule.max * w, fitted)) * scale;
};

/* ------------------------------------------------------------------- words */

export const applyCase = (text: string, mode: TextCase = 'lower'): string => {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'as-typed') return text;
  return text.toLowerCase();
};

export const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const splitWords = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

const normalise = (word: string): string =>
  word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

export const isEmphasised = (word: string, emphasis?: string[]): boolean => {
  if (!emphasis || emphasis.length === 0) return false;
  const target = normalise(word);
  if (!target) return false;
  return emphasis.some((candidate) => normalise(candidate) === target);
};

/** Horizontal placement of a line inside its block. */
export const textAlignFor = (
  alignment: Alignment,
  fallback: Alignment,
): Alignment => (alignment === 'center' ? fallback : alignment);

export const justifyFor = (alignment: Alignment): 'flex-start' | 'center' | 'flex-end' =>
  alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center';
