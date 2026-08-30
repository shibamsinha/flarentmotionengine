/**
 * The built-in icon set.
 *
 * Deliberately small and deliberately hand-written. The brief rules out an icon
 * marketplace, and these are the glyphs product-demo motion actually reaches
 * for — the reference video alone needs check, plus, upload, folder, file,
 * camera and scan.
 *
 * All are stroked paths on a 24×24 grid with no fills, which buys three things:
 * they recolour from one prop, they scale to any size without a raster, and
 * `draw-in` works — a stroke can be dashed and drawn on, a filled shape cannot.
 */

import React from 'react';
import type { IconName } from '../../../types/object';

/** Path data on a 24×24 viewBox, stroked and centred. */
export const ICON_PATHS: Record<IconName, string> = {
  check: 'M4 12.5 L9.5 18 L20 6.5',
  plus: 'M12 5 L12 19 M5 12 L19 12',
  upload: 'M12 16 L12 4 M7 9 L12 4 L17 9 M4 20 L20 20',
  download: 'M12 4 L12 16 M7 11 L12 16 L17 11 M4 20 L20 20',
  folder: 'M3 6 L10 6 L12 9 L21 9 L21 19 L3 19 Z',
  file: 'M6 3 L14 3 L19 8 L19 21 L6 21 Z M14 3 L14 8 L19 8',
  camera: 'M3 8 L7 8 L9 5 L15 5 L17 8 L21 8 L21 19 L3 19 Z M12 16.5 A3.2 3.2 0 1 1 12 10.1 A3.2 3.2 0 1 1 12 16.5',
  scan: 'M4 8 L4 4 L8 4 M16 4 L20 4 L20 8 M20 16 L20 20 L16 20 M8 20 L4 20 L4 16 M4 12 L20 12',
  search: 'M11 18.5 A7.5 7.5 0 1 1 11 3.5 A7.5 7.5 0 1 1 11 18.5 M16.5 16.5 L21 21',
  'arrow-right': 'M4 12 L20 12 M14 6 L20 12 L14 18',
  'chevron-right': 'M9 5 L16 12 L9 19',
  close: 'M6 6 L18 18 M18 6 L6 18',
  heart: 'M12 20 C12 20 3 14.5 3 8.8 A4.8 4.8 0 0 1 12 6.6 A4.8 4.8 0 0 1 21 8.8 C21 14.5 12 20 12 20 Z',
  star: 'M12 3.5 L14.7 9.4 L21 10.2 L16.4 14.6 L17.6 21 L12 17.9 L6.4 21 L7.6 14.6 L3 10.2 L9.3 9.4 Z',
  bell: 'M6 10 A6 6 0 0 1 18 10 C18 15 20 17 20 17 L4 17 C4 17 6 15 6 10 Z M10 20 A2.4 2.4 0 0 0 14 20',
  user: 'M12 12 A4 4 0 1 1 12 4 A4 4 0 1 1 12 12 M4.5 21 C4.5 16.8 7.9 14 12 14 C16.1 14 19.5 16.8 19.5 21',
  lock: 'M5 11 L19 11 L19 21 L5 21 Z M8 11 L8 7.5 A4 4 0 0 1 16 7.5 L16 11',
  play: 'M7 4.5 L19 12 L7 19.5 Z',
};

/**
 * `pathLength` is normalised to 100 so a dash offset can be expressed as a
 * percentage regardless of how long the real path is — that is what lets
 * `draw-in` use one number for every icon instead of measuring each.
 */
export const Icon: React.FC<{
  name: IconName;
  color: string;
  weight?: number;
  /** 0..1. Below 1 the stroke is partially drawn. */
  draw?: number;
}> = ({ name, color, weight = 2, draw = 1 }) => (
  <svg
    viewBox="0 0 24 24"
    width="100%"
    height="100%"
    fill="none"
    stroke={color}
    strokeWidth={weight}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', overflow: 'visible' }}
  >
    <path
      d={ICON_PATHS[name]}
      pathLength={100}
      strokeDasharray={draw >= 1 ? undefined : 100}
      strokeDashoffset={draw >= 1 ? undefined : 100 - draw * 100}
    />
  </svg>
);
