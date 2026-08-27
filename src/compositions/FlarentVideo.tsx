/**
 * The composition.
 *
 * Scenes are laid end to end with <Series>. The film's length is whatever the
 * scenes add up to — see `calculateFlarentMetadata`, which is wired into the
 * <Composition> so Remotion derives durationInFrames from the props instead of
 * from a constant. Add a scene and the video gets longer; that is the whole
 * contract.
 *
 * V2 note: scene sequences still do not overlap. Each scene is handed its
 * predecessor and renders that scene's exit inside its own first few frames,
 * which produces the overlap visually while leaving the timeline — and the
 * frame count — exactly as it was.
 */

import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import type { FlarentVideoProps } from '../types/scene';
import { CANVAS, buildTimeline, totalFrames } from '../utils/timing';
import { DEFAULT_PALETTE, FIELDS } from '../utils/typography';
import { OverlayLayer } from '../components/motion/OverlayLayer';
import { SceneRenderer } from './SceneRenderer';

export const FlarentVideo: React.FC<FlarentVideoProps> = ({
  scenes,
  palette = DEFAULT_PALETTE,
  fields,
  overlay,
}) => {
  const timeline = buildTimeline(scenes, CANVAS.fps);
  const base = fields?.cream ?? FIELDS.cream;

  if (timeline.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: base }} />;
  }

  return (
    /**
     * V3 — the frame is the clipping window.
     *
     * Oversized type is meant to run past the edges, so the crop has to be an
     * explicit property of the composition rather than a side effect of what the
     * renderer happens to capture. Without this the MP4 would still clip (the
     * canvas is 1080×1920) but the editor's <Player> would let a bleeding word
     * spill over the surrounding UI, and the preview would stop telling the
     * truth about the render.
     *
     * Only the root clips. Scene layers stay `overflow: visible` so a motion-blur
     * filter region is not cut off at its own scene boundary.
     */
    <AbsoluteFill style={{ backgroundColor: base, overflow: 'hidden' }}>
      <Series>
        {timeline.map((entry, index) => {
          const before = index > 0 ? timeline[index - 1] : undefined;
          return (
            <Series.Sequence
              key={entry.scene.id}
              durationInFrames={entry.durationInFrames}
              layout="none"
            >
              <SceneRenderer
                scene={entry.scene}
                durationInFrames={entry.durationInFrames}
                palette={palette}
                fields={fields}
                previous={
                  before
                    ? {
                        scene: before.scene,
                        durationInFrames: before.durationInFrames,
                      }
                    : undefined
                }
              />
            </Series.Sequence>
          );
        })}
      </Series>
      {/*
        Outside the <Series>, and after it, so it sits over every scene and
        belongs to none of them. This position in the tree *is* the feature:
        move it inside a sequence and it inherits that scene's lifetime and
        gets re-mounted at every boundary.
      */}
      {overlay ? <OverlayLayer overlay={overlay} scenes={scenes} /> : null}
    </AbsoluteFill>
  );
};

export const calculateFlarentMetadata: CalculateMetadataFunction<
  FlarentVideoProps
> = ({ props }) => ({
  durationInFrames: totalFrames(props.scenes ?? [], CANVAS.fps),
  fps: CANVAS.fps,
  width: CANVAS.width,
  height: CANVAS.height,
});

export const FLARENT_COMPOSITION_ID = 'FlarentVideo';
