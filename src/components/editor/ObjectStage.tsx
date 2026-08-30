/**
 * Dragging and resizing objects on the canvas.
 *
 * Thin on purpose: `BoxStage` already owns the pointer arithmetic — capture,
 * corner aspect locking, mapping screen pixels back through the preview scale —
 * for the scene picture and the static overlay. This is a third caller of it,
 * not a third copy of it. All it adds is the unit conversion, because objects
 * are stored in fractions of the frame and `BoxStage` works in composition
 * pixels.
 *
 * Only the selected object gets a box. Drawing a handle set around every object
 * in the scene would put more chrome on the frame than frame, and the list is
 * where objects are found; the canvas is where the selected one is *placed*.
 *
 * Nested children are not draggable here. Their coordinates are relative to
 * their container, so a drag would need to walk back up the tree applying each
 * ancestor's transform — worth doing, but not worth guessing at before the flat
 * case has been used in anger.
 */

import React from 'react';
import type { SceneObject } from '../../types/object';
import type { VideoConfig } from '../../types/scene';
import { BoxStage } from './BoxStage';

export const ObjectStage: React.FC<{
  objects: SceneObject[] | undefined;
  selectedId: string | null;
  canvas: VideoConfig;
  /** Suppressed during playback — handles over a moving frame are noise. */
  active: boolean;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<SceneObject>) => void;
}> = ({ objects, selectedId, canvas, active, onSelect, onChange }) => {
  if (!active || !selectedId) return null;

  // Top level only; see the note above about nested coordinates.
  const object = (objects ?? []).find((o) => o.id === selectedId);
  if (!object) return null;

  // A cursor's position comes from its stops, not its box, so there is nothing
  // here to drag — moving the box would silently do nothing.
  if (object.type === 'cursor') return null;

  return (
    <BoxStage
      canvas={canvas}
      rect={{
        x: object.x * canvas.width,
        y: object.y * canvas.height,
        width: object.width * canvas.width,
        height: object.height * canvas.height,
      }}
      min={{ width: canvas.width * 0.02, height: canvas.height * 0.01 }}
      selected
      onSelect={() => onSelect(object.id)}
      onChange={(box) =>
        onChange({
          x: box.x / canvas.width,
          y: box.y / canvas.height,
          width: box.width / canvas.width,
          height: box.height / canvas.height,
        })
      }
      readout={(box) =>
        `${Math.round((box.width / canvas.width) * 100)}% × ${Math.round(
          (box.height / canvas.height) * 100,
        )}%`
      }
    />
  );
};
