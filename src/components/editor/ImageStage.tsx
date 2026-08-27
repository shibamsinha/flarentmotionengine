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
import type { Scene } from '../../types/scene';
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
}> = ({ scene, active, selected, onSelect, onChange }) => {
  const image = scene?.image;

  const commit = useCallback(
    (box: Box) => {
      if (!scene?.image) return;
      onChange({
        image: {
          ...scene.image,
          placement: 'free',
          x: box.x / CANVAS.width,
          y: box.y / CANVAS.height,
          width: box.width / CANVAS.width,
          height: box.height / CANVAS.height,
        },
      });
    },
    [scene, onChange],
  );

  // Seed `free` from the current preset rect the moment a drag starts, so the
  // first pixel of movement does not also move the box.
  const grab = useCallback(() => {
    if (!scene?.image || scene.image.placement === 'free') return;
    const seeded = freeBoxFrom(composeImage(scene.image));
    onChange({ image: { ...scene.image, placement: 'free', ...seeded } });
  }, [scene, onChange]);

  if (!scene || !image || !active) return null;

  return (
    <BoxStage
      rect={composeImage(image).rect}
      min={{ width: FREE_MIN * CANVAS.width, height: FREE_MIN * CANVAS.height }}
      onChange={commit}
      onGrab={grab}
      selected={selected}
      onSelect={onSelect}
      variant="image"
    />
  );
};
