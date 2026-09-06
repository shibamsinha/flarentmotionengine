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
import { AbsoluteFill, Series, useVideoConfig } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import type { FlarentVideoProps } from '../types/scene';
import { buildTimeline, canvasFor, totalFrames } from '../utils/timing';
import { DEFAULT_PALETTE, FIELDS } from '../utils/typography';
import { OverlayLayer } from '../components/motion/OverlayLayer';
import { AudioTrack } from '../components/motion/AudioTrack';
import { SceneRenderer } from './SceneRenderer';

export const FlarentVideo: React.FC<FlarentVideoProps> = ({
  scenes,
  palette = DEFAULT_PALETTE,
  fields,
  ink,
  accent,
  overlay,
  audio,
}) => {
  // Read back from Remotion's own config rather than from `format` directly:
  // `calculateFlarentMetadata` below is what actually decided the frame shape
  // for this render, so asking the same way every descendant does (via
  // `useVideoConfig`) is what keeps this component from being a second,
  // possibly-diverging source of truth.
  const { fps, width, height } = useVideoConfig();
  const canvas = { width, height, fps };
  const timeline = buildTimeline(scenes, fps);
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
                ink={ink}
                accent={accent}
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
      {overlay ? (
        <OverlayLayer overlay={overlay} scenes={scenes} fps={fps} canvas={canvas} />
      ) : null}
      {/*
        V7 — the project's audio, outside the <Series> for the same reason the
        overlay is: it belongs to the film, not to a scene. Inside a sequence it
        would inherit that scene's lifetime and restart at every boundary.

        Being inside the composition at all is what makes the editor's <Player>
        and the headless render share one clock — there is no second audio
        timeline anywhere in the app.
      */}
      {audio ? (
        <AudioTrack
          audio={audio}
          fps={fps}
          durationInFrames={totalFrames(scenes, fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};

export const calculateFlarentMetadata: CalculateMetadataFunction<
  FlarentVideoProps
> = ({ props }) => {
  const canvas = canvasFor(props.format);
  return {
    durationInFrames: totalFrames(props.scenes ?? [], canvas.fps),
    fps: canvas.fps,
    width: canvas.width,
    height: canvas.height,
  };
};

export const FLARENT_COMPOSITION_ID = 'FlarentVideo';
