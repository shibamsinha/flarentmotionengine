/**
 * Where a scene's picture sits, and what room that leaves the type.
 *
 * The engine never lets type land on a picture by accident: `panel` and `split`
 * carve the frame into a picture band and a type band, and the planner centres
 * the ink inside whatever is left. `full` is the only placement where type sits
 * over the image, and that one gets a flat tint of the field colour so the
 * words keep their contrast without a generic dark gradient.
 */

import type { SceneImage, VideoConfig } from '../types/scene';
import { CANVAS } from './timing';
import { sideMargin } from './typography';

export type Rect = { x: number; y: number; width: number; height: number };

export type ImageComposition = {
  rect: Rect;
  /** Vertical band the type may use. */
  typeTop: number;
  typeBottom: number;
  /** Flat field tint laid over the picture, 0..1. */
  scrim: number;
  focusX: number;
  focusY: number;
  /** True when type is allowed to sit over the picture. */
  overlaps: boolean;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Falls back when a stored value is missing or not a real number. */
const finite = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const PANEL_MIN = 0.18;
export const PANEL_MAX = 0.72;

/** Smallest a free box may get, as a fraction of the frame. */
export const FREE_MIN = 0.05;

/**
 * The box a preset currently occupies, in frame fractions. Used when switching
 * a picture to `free` so it starts exactly where it already is rather than
 * jumping to a default.
 */
export const freeBoxFrom = (
  composition: ImageComposition,
  canvas: VideoConfig = CANVAS,
): { x: number; y: number; width: number; height: number } => ({
  x: composition.rect.x / canvas.width,
  y: composition.rect.y / canvas.height,
  width: composition.rect.width / canvas.width,
  height: composition.rect.height / canvas.height,
});

export const composeImage = (
  image: SceneImage | undefined,
  canvas: VideoConfig = CANVAS,
): ImageComposition => {
  const { width: W, height: H } = canvas;
  const margin = sideMargin(canvas);
  /** Air between the picture band and the type band. */
  const bandGap = margin * 0.85;

  const full: ImageComposition = {
    rect: { x: 0, y: 0, width: W, height: H },
    typeTop: 0,
    typeBottom: H,
    scrim: clamp(finite(image?.scrim, 0.42), 0, 0.95),
    focusX: clamp(finite(image?.focusX, 0.5), 0, 1),
    focusY: clamp(finite(image?.focusY, 0.5), 0, 1),
    overlaps: true,
  };

  if (!image) return { ...full, scrim: 0 };
  if (image.placement === 'full') return full;

  const side = image.side ?? 'top';
  const focusX = clamp(finite(image.focusX, 0.5), 0, 1);
  const focusY = clamp(finite(image.focusY, 0.5), 0, 1);

  if (image.placement === 'free') {
    // Free boxes may hang off the frame — that is the point — so position is
    // not clamped. Only the size has a floor, to keep a dragged box grabbable.
    // Every value is passed through `finite` because a restored auto-save or an
    // imported script can carry a NaN, and one NaN here poisons the whole layout.
    const width = Math.max(FREE_MIN * W, finite(image.width, 0.5) * W);
    const height = Math.max(FREE_MIN * H, finite(image.height, 0.32) * H);
    return {
      rect: {
        x: finite(image.x, 0.25) * W,
        y: finite(image.y, 0.34) * H,
        width,
        height,
      },
      // A free picture is a floating element; the type keeps the whole frame
      // and the two are allowed to overlap however the layout wants.
      typeTop: 0,
      typeBottom: H,
      scrim: clamp(finite(image.scrim, 0), 0, 0.95),
      focusX,
      focusY,
      overlaps: true,
    };
  }

  if (image.placement === 'split') {
    // Full-bleed half. No inset — the picture meets three frame edges, which is
    // what makes a split read as a split rather than a floating block.
    const height = H / 2;
    const y = side === 'top' ? 0 : H - height;
    return {
      rect: { x: 0, y, width: W, height },
      typeTop: side === 'top' ? height + bandGap : margin,
      typeBottom: side === 'top' ? H - margin : y - bandGap,
      scrim: clamp(finite(image.scrim, 0), 0, 0.95),
      focusX,
      focusY,
      overlaps: false,
    };
  }

  // panel — an inset plate on the safe margin.
  const height = H * clamp(finite(image.size, 0.42), PANEL_MIN, PANEL_MAX);
  const y = side === 'top' ? margin : H - margin - height;
  return {
    rect: { x: margin, y, width: W - margin * 2, height },
    typeTop: side === 'top' ? y + height + bandGap : margin,
    typeBottom: side === 'top' ? H - margin : y - bandGap,
    scrim: clamp(finite(image.scrim, 0), 0, 0.95),
    focusX,
    focusY,
    overlaps: false,
  };
};

/** Centre of the band the type is allowed to occupy. */
export const typeCentreY = (composition: ImageComposition): number =>
  (composition.typeTop + composition.typeBottom) / 2;

export const typeBandHeight = (composition: ImageComposition): number =>
  Math.max(1, composition.typeBottom - composition.typeTop);
