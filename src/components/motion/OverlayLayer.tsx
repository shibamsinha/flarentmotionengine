/**
 * The static overlay.
 *
 * A project-level image that sits over the whole reel — a logo, a watermark, a
 * fixed plate. The entire point is that it is *not* part of any scene, so it is
 * rendered as a sibling of `<Series>` rather than inside it:
 *
 *   - no scene's entrance, exit, blur or drift can reach it
 *   - it is one element for the whole film, not one per scene, so nothing
 *     re-mounts or re-times at a boundary
 *   - the type composes as if it were not there; unlike a `SceneImage` it does
 *     not carve a band out of the frame
 *
 * Nothing here reads anything but the frame, and it reads that only to answer
 * one question: is the scene currently on screen one that opted out.
 *
 * Scenes opting out is a hard cut. It coincides with a scene change — where the
 * reel already cuts — so a fade would be the only soft edge in the film.
 */

import React from 'react';
import { Img, useCurrentFrame } from 'remotion';
import type { OverlayImage, Scene } from '../../types/scene';
import { CANVAS, buildTimeline, sceneAtFrame } from '../../utils/timing';
import { resolveImageSrc } from './SceneImageLayer';

/** Falls back when a stored value is missing or not a real number. */
const finite = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Smallest an overlay box may get, as a fraction of the frame. */
export const OVERLAY_MIN = 0.03;

export const DEFAULT_OVERLAY: Omit<OverlayImage, 'src'> = {
  // Top-left, inside the safe margin, at a logo-ish size. A sensible place to
  // land rather than a statement — it is meant to be dragged from here.
  x: 0.08,
  y: 0.05,
  width: 0.26,
  height: 0.09,
  fit: 'contain',
  opacity: 1,
};

/** The box an overlay occupies, in canvas px. Shared with the editor's handles. */
export const overlayRect = (overlay: OverlayImage) => ({
  x: finite(overlay.x, DEFAULT_OVERLAY.x) * CANVAS.width,
  y: finite(overlay.y, DEFAULT_OVERLAY.y) * CANVAS.height,
  width: Math.max(OVERLAY_MIN, finite(overlay.width, DEFAULT_OVERLAY.width)) * CANVAS.width,
  height:
    Math.max(OVERLAY_MIN, finite(overlay.height, DEFAULT_OVERLAY.height)) * CANVAS.height,
});

export const OverlayLayer: React.FC<{
  overlay: OverlayImage;
  /** Needed only to find which scene the playhead is in. */
  scenes: Scene[];
  fps?: number;
}> = ({ overlay, scenes, fps = CANVAS.fps }) => {
  const frame = useCurrentFrame();
  if (!overlay.src) return null;

  const current = sceneAtFrame(buildTimeline(scenes, fps), frame);
  if (current?.scene.hideOverlay) return null;

  const rect = overlayRect(overlay);
  const opacity = clamp01(finite(overlay.opacity, 1));
  if (opacity <= 0.001) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
        // No willChange and no transform: this element genuinely never moves,
        // and promoting it to its own layer for the whole film would cost
        // memory for nothing.
        pointerEvents: 'none',
      }}
    >
      <Img
        src={resolveImageSrc(overlay.src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: overlay.fit ?? 'contain',
        }}
      />
    </div>
  );
};
