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
import type { OverlayImage, Scene } from '../../types/scene';
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
}> = ({ overlay, scenes, frame, active, selected, onSelect, onChange }) => {
  const commit = useCallback(
    (box: Box) => {
      if (!overlay) return;
      onChange({
        ...overlay,
        // Stored as frame fractions, and deliberately not clamped — dragging
        // the overlay half off the edge is a placement, not a mistake.
        x: round4(box.x / CANVAS.width),
        y: round4(box.y / CANVAS.height),
        width: round4(box.width / CANVAS.width),
        height: round4(box.height / CANVAS.height),
      });
    },
    [overlay, onChange],
  );

  if (!overlay || !active) return null;
  if (sceneAtFrame(buildTimeline(scenes, CANVAS.fps), frame)?.scene.hideOverlay) {
    return null;
  }

  return (
    <BoxStage
      rect={overlayRect(overlay)}
      min={{ width: OVERLAY_MIN * CANVAS.width, height: OVERLAY_MIN * CANVAS.height }}
      onChange={commit}
      selected={selected}
      onSelect={onSelect}
      variant="overlay"
      readout={(box) =>
        `${Math.round((box.width / CANVAS.width) * 100)}% × ${Math.round(
          (box.height / CANVAS.height) * 100,
        )}%`
      }
    />
  );
};
