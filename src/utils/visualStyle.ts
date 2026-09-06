/**
 * Visual styles — V4.
 *
 * V2 was about how type *moves*. V3 was about where it *lives*. V4 is about how
 * it *looks*, and the whole point of the file is that those are three separate
 * systems: nothing here knows which animation is playing, and no animation
 * component knows which style is applied. The renderer composes them.
 *
 *   TEXT → TYPOGRAPHY → VISUAL STYLE → ANIMATION → COMPOSITION → BLUR → FRAME
 *
 * That separation is why there are four styles and five animations rather than
 * twenty components. Adding a fifth style is: add a name, add an entry to
 * `VISUAL_STYLES`, teach `styleCss` how to paint it. No animation file changes.
 *
 * MEASURED FROM `Dynamic Text [Kinetic typography].mp4`:
 *   solid ink on light      #2645B2   (a real blue, not black)
 *   dark field              #302E2F
 *   light field             #E0E0E0
 *   gradient warm end       #FC8F25
 *   gradient light middle   #F3F0F2
 *   gradient cool end       #89DFF3
 *   outline stroke          2px on a 38px cap height — 3.8% of font size
 */

import type { Theme } from './typography';

/* ------------------------------------------------------------------ names */

export type VisualStyleName = 'solid' | 'outline' | 'gradient' | 'split';

export const VISUAL_STYLE_NAMES: VisualStyleName[] = [
  'solid',
  'outline',
  'gradient',
  'split',
];

export type GradientConfig = {
  colors: string[];
  /** Degrees, CSS convention: 0 = up, 90 = to the right. */
  angle: number;
};

/**
 * How a piece of type is painted.
 *
 * Every field is optional. Anything left out is resolved against the scene's
 * field colour, so `{ type: 'solid' }` is a complete, correct style — the ink
 * that reads on this background. Styles carry colour *decisions*, not colour
 * requirements.
 */
export type VisualStyleConfig = {
  type: VisualStyleName;
  /** Glyph fill. SOLID uses it; OUTLINE leaves it unset for a hollow letter. */
  fillColor?: string;
  strokeColor?: string;
  /**
   * Stroke weight as a **fraction of the font size**, not pixels.
   *
   * The reference sets 3.8% at a small size. A fixed pixel weight would give an
   * OVERSIZED word a hairline and a caption a slab, which is Part 9's
   * "disappearing outlines" in both directions.
   */
  strokeWidth?: number;
  gradient?: GradientConfig;
  opacity?: number;
  /**
   * SPLIT only — the treatments to alternate between. Two is the useful case;
   * more work.
   */
  parts?: VisualStyleConfig[];
  /**
   * SPLIT only. `word` gives each word a different treatment; `letter` splits a
   * single run of glyphs into bands. `auto` picks letter for a one-word element
   * and word otherwise, which is the only rule that makes SPLIT mean something
   * for both "MORE CUSTOMERS" and "DYNAMIC".
   */
  splitBy?: 'auto' | 'word' | 'letter';
};

/* ----------------------------------------------------------------- colours */

/**
 * Named colours, so a script can say BLUE rather than a hex it had to guess.
 * Arbitrary hex is always allowed — this is a vocabulary, not a restriction.
 */
export const COLOR_TOKENS: Record<string, string> = {
  white: '#FFFFFF',
  black: '#0F0F0F',
  cream: '#EEEEEE',
  dark_green: '#13581D',
  deep_green: '#214E1B',
  // Sampled from the reference, where it is the solid treatment on light.
  blue: '#2645B2',
};

export const COLOR_TOKEN_NAMES = Object.keys(COLOR_TOKENS);

/** A token name, a hex value, or nothing. Resolves to a hex, or the fallback. */
export const resolveColor = (
  value: string | undefined,
  fallback: string,
): string => {
  if (!value) return fallback;
  const token = COLOR_TOKENS[value.trim().toLowerCase()];
  if (token) return token;
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;
};

/**
 * The house gradient. Orange → pink → white → cyan, the ramp measured in the
 * reference, and warm-to-cool so it reads as one move rather than as a rainbow.
 * It sits on both fields because it passes through near-white in the middle.
 */
export const HOUSE_GRADIENT: GradientConfig = {
  colors: ['#FF8A3D', '#F45B9A', '#F5F5F5', '#8DE7F2'],
  angle: 90,
};

/* ---------------------------------------------------------------- registry */

export type VisualStyleDefinition = {
  id: VisualStyleName;
  label: string;
  /** One line, shown in the editor. */
  description: string;
  /** When this style earns its place. Guidance, not a rule. */
  use: string;
  /** Filled in against the scene's theme when the author sets nothing. */
  defaults: (theme: Theme) => Omit<VisualStyleConfig, 'type'>;
};

export const VISUAL_STYLES: Record<VisualStyleName, VisualStyleDefinition> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    description: 'One colour, filled. The house treatment.',
    use: 'Statements, setup, explanation.',
    defaults: (theme) => ({ fillColor: theme.ink, opacity: 1 }),
  },
  outline: {
    id: 'outline',
    label: 'Outline',
    description: 'Hollow letters drawn as a stroke. No glow, no shadow.',
    use: 'Contrast, tension, the quieter beat before a loud one.',
    defaults: (theme) => ({
      strokeColor: theme.ink,
      // Slightly under the reference's 3.8%: that was measured on small type,
      // and the same ratio on a frame-filling word reads as a slab.
      strokeWidth: 0.03,
      // No fill — a hollow letter is the whole idea.
      opacity: 1,
    }),
  },
  gradient: {
    id: 'gradient',
    label: 'Gradient',
    description: 'A ramp painted inside the glyphs, not behind them.',
    use: 'The important idea. Energy, climax, the line that matters.',
    defaults: () => ({ gradient: HOUSE_GRADIENT, opacity: 1 }),
  },
  split: {
    id: 'split',
    label: 'Split',
    description: 'Two treatments in one piece of type.',
    use: 'Comparisons, two-part ideas, one word doing two jobs.',
    defaults: (theme) => ({
      opacity: 1,
      splitBy: 'auto',
      parts: [
        { type: 'solid', fillColor: theme.ink },
        { type: 'gradient', gradient: HOUSE_GRADIENT },
      ],
    }),
  },
};

export const styleDefinitionOf = (
  name: VisualStyleName | undefined,
): VisualStyleDefinition => VISUAL_STYLES[name ?? 'solid'] ?? VISUAL_STYLES.solid;

export const DEFAULT_VISUAL_STYLE: VisualStyleName = 'solid';

/* ---------------------------------------------------------------- resolve */

/** A style with every value filled in, ready to paint. */
export type ResolvedStyle = {
  type: VisualStyleName;
  fill: string | null;
  stroke: { color: string; width: number } | null;
  gradient: GradientConfig | null;
  opacity: number;
  parts: ResolvedStyle[];
  splitBy: 'auto' | 'word' | 'letter';
};

/**
 * Fill in a config against the field it is being painted on.
 *
 * Theme-aware by default is what keeps the styles part of one design language
 * rather than four unrelated looks: SOLID and OUTLINE on a green field come out
 * white, on cream they come out deep green, and neither needed to be told.
 */
export const resolveStyle = (
  config: VisualStyleConfig | undefined,
  theme: Theme,
  depth = 0,
): ResolvedStyle => {
  const type = config?.type ?? DEFAULT_VISUAL_STYLE;
  const definition = styleDefinitionOf(type);
  const base = definition.defaults(theme);
  const merged = { ...base, ...config };

  const stroke =
    merged.strokeColor !== undefined || merged.strokeWidth !== undefined
      ? {
          color: resolveColor(merged.strokeColor, theme.ink),
          width: merged.strokeWidth ?? 0.03,
        }
      : null;

  return {
    type,
    fill: merged.fillColor ? resolveColor(merged.fillColor, theme.ink) : null,
    stroke,
    gradient: merged.gradient ?? null,
    opacity: merged.opacity ?? 1,
    // One level of nesting only. A SPLIT of SPLITs has no meaning anyone could
    // read on screen, and unbounded recursion here would be a rendering hazard.
    parts:
      type === 'split' && depth === 0
        ? (merged.parts ?? []).map((part) => resolveStyle(part, theme, depth + 1))
        : [],
    splitBy: merged.splitBy ?? 'auto',
  };
};

/**
 * A CSS `linear-gradient`, in the convention the config uses.
 *
 * CSS angles already run 0 = up, 90 = right, so the config value passes
 * straight through — worth stating, because getting this wrong silently flips
 * every gradient in the reel.
 */
export const gradientCss = (gradient: GradientConfig): string => {
  const colors = gradient.colors.length > 0 ? gradient.colors : HOUSE_GRADIENT.colors;
  const stops = colors.length === 1 ? [colors[0], colors[0]] : colors;
  return `linear-gradient(${gradient.angle}deg, ${stops.join(', ')})`;
};

/** Stroke weight in px for a given font size, kept inside readable bounds. */
export const strokePx = (ratio: number, fontSize: number): number =>
  Math.min(18, Math.max(1.5, ratio * fontSize));

/**
 * Where a piece of type sits inside its element, so a gradient can be sized to
 * the element and offset to the word.
 */
export type GlyphBox = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

/**
 * The CSS that paints one run of glyphs.
 *
 * Exported because the editor's style previews use it too — a preview drawn
 * with its own approximation of the style is a preview that will eventually
 * lie about what renders.
 */
export const styleCss = (
  style: ResolvedStyle,
  fontSize: number,
  box: GlyphBox,
): Record<string, string | number> => {
  const css: Record<string, string | number> = {};

  if (style.gradient) {
    css.backgroundImage = gradientCss(style.gradient);
    // Size the ramp to the element and slide it to this word's position: the
    // gradient is a property of the phrase, not of each word in it.
    css.backgroundSize = `${Math.max(1, box.width)}px ${Math.max(1, box.height)}px`;
    css.backgroundPosition = `${-box.offsetX}px ${-box.offsetY}px`;
    css.backgroundRepeat = 'no-repeat';
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    // The fill must be transparent for the clip to show, so a gradient always
    // wins over a fill colour rather than fighting it.
    css.color = 'transparent';
  } else if (style.fill) {
    css.color = style.fill;
  } else if (style.stroke) {
    // Hollow: no fill named, so the stroke is the letter.
    css.color = 'transparent';
  }

  if (style.stroke) {
    css.WebkitTextStrokeWidth = `${strokePx(style.stroke.width, fontSize).toFixed(2)}px`;
    css.WebkitTextStrokeColor = style.stroke.color;
  }

  if (style.opacity !== 1) css.opacity = style.opacity;

  return css;
};

/**
 * Whether a style paints anything at all. A config that resolves to no fill, no
 * stroke and no gradient would render invisible type, which is never what was
 * meant — SOLID's theme ink is the backstop.
 */
export const paints = (style: ResolvedStyle): boolean =>
  style.fill !== null ||
  style.stroke !== null ||
  style.gradient !== null ||
  style.parts.length > 0;
