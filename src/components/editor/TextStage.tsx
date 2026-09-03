/**
 * Dragging type around the canvas.
 *
 * The data model already allowed this: `SceneElement.x`/`y` place an element's
 * *ink centre* as fractions of the frame, and the planner has always honoured
 * them — "elements placed this way are exempt from collision nudging". What was
 * missing was a way to set them without typing numbers. This is that.
 *
 * **It drags elements, and a word is an element.** "Move this word" and "move
 * this whole line" are the same operation on different-sized elements, which is
 * why there is no separate word-dragging mode: the scene editor's
 * "Compose · split into elements" turns a line into one element per phrase, and
 * from then on each is independently draggable. One concept, not two.
 *
 * **The box comes from the planner, not from a guess.** `planScene` is the same
 * function `SceneRenderer` calls, so the rectangle drawn here is exactly where
 * the type is rendered — including for oversized type that runs off the frame.
 * Re-deriving positions with a simpler rule would drift from the render the
 * moment a composition did anything interesting.
 */

import React, { useCallback, useMemo } from 'react';
import type { PaletteName, Scene, SceneElement, VideoConfig } from '../../types/scene';
import { planScene } from '../../utils/plan';
import { totalFrames } from '../../utils/timing';
import { useFontsReady } from '../../utils/fonts';
import { BoxStage } from './BoxStage';

export const TextStage: React.FC<{
  scene: Scene | null;
  palette: PaletteName;
  canvas: VideoConfig;
  /** Which element is being edited, or null for none. */
  selectedElementId: string | null;
  /** Suppressed during playback — handles over moving type are noise. */
  active: boolean;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<Scene>) => void;
}> = ({ scene, palette, canvas, selectedElementId, active, onSelect, onChange }) => {
  const fontsReady = useFontsReady();

  /**
   * The same plan the renderer builds. Measurement is module-cached, so this
   * costs arithmetic rather than a second layout pass — and it is memoised on
   * the scene so dragging does not re-plan on every pointer move.
   */
  const plan = useMemo(() => {
    if (!scene || !fontsReady) return null;
    const frames = Math.max(1, totalFrames([scene], canvas.fps));
    try {
      return planScene(scene, frames, canvas.fps, palette, canvas);
    } catch {
      // A half-typed scene can fail to measure; the canvas should not go blank
      // because of it.
      return null;
    }
  }, [scene, palette, canvas, fontsReady]);

  const setElement = useCallback(
    (id: string, patch: Partial<SceneElement>) => {
      if (!scene?.elements) return;
      onChange({
        elements: scene.elements.map((element) =>
          element.id === id ? { ...element, ...patch } : element,
        ),
      });
    },
    [scene, onChange],
  );

  if (!active || !scene || !plan) return null;

  // Only composed scenes can be dragged: a plain-text scene has one implicit
  // element with no `id` in the document, so there is nothing to write back to.
  // The editor's "split into elements" is the way in, and the hint says so.
  if (!scene.elements || scene.elements.length === 0) return null;

  /*
   * A box per element, not just for the selected one. BoxStage draws an
   * unselected box as an invisible hit area that outlines on hover, so this
   * makes every piece of type on the frame directly grabbable — click the word
   * you want and drag it. Selecting first through a list would be a step
   * nobody expects from a canvas.
   */
  return (
    <>
      {plan.elements.map((planned) => {
        const { block } = planned;
        const rect = {
          x: block.left,
          y: block.top,
          width: Math.max(1, block.width),
          height: Math.max(1, block.inkHeight),
        };
        return (
          <BoxStage
            key={planned.id}
            canvas={canvas}
            /*
             * The ink box, not the line box. `block.top` is where the type is
             * drawn and `inkHeight` is the height of the actual letters, so the
             * rectangle lands on what the user can see rather than on the
             * leading around it.
             */
            rect={rect}
            /*
             * Type is not resized by dragging. Size here is semantic (`size`,
             * `scale`) and a freely-resized word would break the role hierarchy
             * the composition system rests on — so the minimum equals the
             * current size and the corner handles cannot shrink it.
             */
            min={{ width: rect.width, height: rect.height }}
            selected={planned.id === selectedElementId}
            onSelect={() => onSelect(planned.id)}
            onChange={(box) => {
              /*
               * `x`/`y` are the ink *centre*; `block.left`/`top` are its
               * top-left, so the drag converts. `inkCentre` is the planner's own
               * offset from the block origin to the middle of the ink — using it
               * rather than height/2 is what makes a multi-line element land
               * where it looks like it should.
               */
              setElement(planned.id, {
                x: (box.x + block.width / 2) / canvas.width,
                y: (box.y + block.inkCentre) / canvas.height,
              });
            }}
            readout={(box) =>
              `${Math.round(((box.x + block.width / 2) / canvas.width) * 100)}% · ` +
              `${Math.round(((box.y + block.inkCentre) / canvas.height) * 100)}%`
            }
          />
        );
      })}
    </>
  );
};
