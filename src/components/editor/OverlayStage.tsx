/**
 * Direct manipulation of the static overlay, on the canvas.
 *
 * The overlay is a project-level object rather than a scene one, so unlike the
 * picture stage it does not care which scene is selected — it is draggable
 * wherever the playhead happens to be. The one exception is a scene that opted
 * out: there is nothing on screen to drag there, and showing handles over an
 * invisible thing would be the editor lying about what will render.
 */

import React, { useCallback } from 'react';
import type { OverlayImage, Scene, VideoConfig } from '../../types/scene';
import { CANVAS, buildTimeline, sceneAtFrame } from '../../utils/timing';
import { OVERLAY_MIN, overlayRect } from '../motion/OverlayLayer';
import { BoxStage, type Box } from './BoxStage';

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export const OverlayStage: React.FC<{
  overlay: OverlayImage | null;
  scenes: Scene[];
  /** Absolute frame the playhead is on — only used to find the current scene. */
  frame: number;
  /** Handles are for a stopped playhead; they would fight playback. */
  active: boolean;
  /** True when the overlay is the current canvas selection. */
  selected: boolean;
  onSelect: () => void;
  onChange: (next: OverlayImage) => void;
  /** The project's frame. Portrait unless the project chose landscape. */
  canvas?: VideoConfig;
}> = ({ overlay, scenes, frame, active, selected, onSelect, onChange, canvas = CANVAS }) => {
  const commit = useCallback(
    (box: Box) => {
      if (!overlay) return;
      onChange({
        ...overlay,
        // Stored as frame fractions, and deliberately not clamped — dragging
        // the overlay half off the edge is a placement, not a mistake.
        x: round4(box.x / canvas.width),
        y: round4(box.y / canvas.height),
        width: round4(box.width / canvas.width),
        height: round4(box.height / canvas.height),
      });
    },
    [overlay, onChange, canvas],
  );

  if (!overlay || !active) return null;
  if (sceneAtFrame(buildTimeline(scenes, CANVAS.fps), frame)?.scene.hideOverlay) {
    return null;
  }

  return (
    <BoxStage
      rect={overlayRect(overlay, canvas)}
      min={{ width: OVERLAY_MIN * canvas.width, height: OVERLAY_MIN * canvas.height }}
      onChange={commit}
      selected={selected}
      onSelect={onSelect}
      variant="overlay"
      canvas={canvas}
      readout={(box) =>
        `${Math.round((box.width / canvas.width) * 100)}% × ${Math.round(
          (box.height / canvas.height) * 100,
        )}%`
      }
    />
  );
};
