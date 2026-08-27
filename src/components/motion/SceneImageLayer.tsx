/**
 * The picture layer.
 *
 * Images get the same motion grammar as the type — the house settle, blur
 * burning off first, and a slow hold drift — rather than the usual slow
 * Ken Burns pan, which would fight the reel's cut-driven rhythm. Under RAPID
 * the image cuts hard, because everything in RAPID cuts hard.
 *
 * `full` placement lays a flat tint of the *field colour* over the picture
 * instead of a black gradient: it keeps the frame on-palette and stops the
 * scene looking like a stock-photo caption.
 */

import React from 'react';
import { Img, staticFile } from 'remotion';
import type { SceneImage } from '../../types/scene';
import type { ImageComposition } from '../../utils/imageLayout';
import { EASE, clamp01 } from '../../utils/easing';
import type { Theme } from '../../utils/typography';
import { ENTER, enterValues, framesFor, toTransform } from './primitives';

/** Uploads live in `public/`; anything absolute is used as-is. */
export const resolveImageSrc = (src: string): string =>
  /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : staticFile(src);

export const SceneImageLayer: React.FC<{
  image: SceneImage;
  composition: ImageComposition;
  frame: number;
  fps: number;
  durationInFrames: number;
  theme: Theme;
  /** RAPID cuts; everything else settles. */
  hardCut: boolean;
}> = ({ image, composition, frame, fps, durationInFrames, theme, hardCut }) => {
  const { rect, scrim, focusX, focusY } = composition;
  const fit = image.fit ?? 'cover';

  const transformFrames = framesFor(ENTER.transform * 1.25, fps);
  const entrance = hardCut
    ? { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 }
    : enterValues(frame, {
        fromScale: 1.06,
        blur: 16,
        transformFrames,
        opacityFrames: framesFor(ENTER.opacity * 1.15, fps),
        blurFrames: framesFor(ENTER.blur * 1.2, fps),
      });

  // A frame of still photography goes dead without a little life in it. 1.8%
  // over the whole shot is felt rather than seen.
  const driftStart = hardCut ? 0 : transformFrames;
  const drift = EASE.inOut(
    clamp01((frame - driftStart) / Math.max(1, durationInFrames - driftStart)),
  );
  const scale = entrance.scale * (1 + 0.018 * drift);

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        overflow: 'hidden',
        backgroundColor: theme.background,
      }}
    >
      <Img
        src={resolveImageSrc(image.src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: fit,
          objectPosition: `${focusX * 100}% ${focusY * 100}%`,
          opacity: entrance.opacity,
          transform: toTransform({ ...entrance, scale }),
          transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
          filter: entrance.blur > 0.05 ? `blur(${entrance.blur.toFixed(2)}px)` : undefined,
          willChange: 'transform, opacity, filter',
        }}
      />
      {scrim > 0.001 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: theme.background,
            opacity: scrim * entrance.opacity,
          }}
        />
      ) : null}
    </div>
  );
};
