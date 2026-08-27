/**
 * Direct manipulation of a scene's picture, on the canvas.
 *
 * The pointer work lives in `BoxStage`; this is the scene-picture half of it —
 * where the box comes from, and what a moved box means.
 *
 * Touching the box switches the picture to `free` placement, seeded from
 * whatever preset it was using, so nothing jumps under the cursor.
 */

import React, { useCallback } from 'react';
import type { Scene, VideoConfig } from '../../types/scene';
import { CANVAS } from '../../utils/timing';
import { FREE_MIN, composeImage, freeBoxFrom } from '../../utils/imageLayout';
import { BoxStage, type Box } from './BoxStage';

export const ImageStage: React.FC<{
  scene: Scene | null;
  /** True when the playhead is inside the selected scene. */
  active: boolean;
  /** True when the picture is the current canvas selection. */
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Scene>) => void;
  /** The project's frame. Portrait unless the project chose landscape. */
  canvas?: VideoConfig;
}> = ({ scene, active, selected, onSelect, onChange, canvas = CANVAS }) => {
  const image = scene?.image;

  const commit = useCallback(
    (box: Box) => {
      if (!scene?.image) return;
      onChange({
        image: {
          ...scene.image,
          placement: 'free',
          x: box.x / canvas.width,
          y: box.y / canvas.height,
          width: box.width / canvas.width,
          height: box.height / canvas.height,
        },
      });
    },
    [scene, onChange, canvas],
  );

  // Seed `free` from the current preset rect the moment a drag starts, so the
  // first pixel of movement does not also move the box.
  const grab = useCallback(() => {
    if (!scene?.image || scene.image.placement === 'free') return;
    const seeded = freeBoxFrom(composeImage(scene.image, canvas), canvas);
    onChange({ image: { ...scene.image, placement: 'free', ...seeded } });
  }, [scene, onChange, canvas]);

  if (!scene || !image || !active) return null;

  return (
    <BoxStage
      rect={composeImage(image, canvas).rect}
      min={{ width: FREE_MIN * canvas.width, height: FREE_MIN * canvas.height }}
      onChange={commit}
      onGrab={grab}
      selected={selected}
      onSelect={onSelect}
      variant="image"
      canvas={canvas}
    />
  );
};
