import React, { useEffect, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { FlarentVideo } from '../../compositions/FlarentVideo';
import type { CanvasFormat, OverlayImage, PaletteName, Scene } from '../../types/scene';
import type { FieldOverrides } from '../../utils/typography';
import type { ProjectAudio } from '../../types/audio';
import { CANVAS, canvasFor, totalFrames } from '../../utils/timing';

export const VideoPreview: React.FC<{
  scenes: Scene[];
  palette: PaletteName;
  format: CanvasFormat;
  fields: FieldOverrides;
  ink: FieldOverrides;
  accent: string | null;
  overlay: OverlayImage | null;
  /** V7 — passed into the composition so the Player drives it from its own clock. */
  audio: ProjectAudio | null;
  playerRef: React.RefObject<PlayerRef | null>;
  onFrame: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
}> = ({ scenes, palette, format, fields, ink, accent, overlay, audio, playerRef, onFrame, onPlayingChange }) => {
  const durationInFrames = totalFrames(scenes, CANVAS.fps);
  const canvas = useMemo(() => canvasFor(format), [format]);
  const inputProps = useMemo(
    () => ({
      scenes, palette, format, fields,
      // Omitted entirely when unset, so a project that overrides neither sends
      // exactly the props it always did.
      ...(Object.keys(ink).length > 0 ? { ink } : {}),
      ...(accent ? { accent } : {}),
      ...(overlay ? { overlay } : {}),
      ...(audio ? { audio } : {}),
    }),
    [scenes, palette, format, fields, ink, accent, overlay, audio],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const frameHandler = (event: { detail: { frame: number } }) =>
      onFrame(event.detail.frame);
    const play = () => onPlayingChange(true);
    const pause = () => onPlayingChange(false);

    player.addEventListener('frameupdate', frameHandler);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    player.addEventListener('ended', pause);
    return () => {
      player.removeEventListener('frameupdate', frameHandler);
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
      player.removeEventListener('ended', pause);
    };
  }, [playerRef, onFrame, onPlayingChange]);

  return (
    <div className="player-frame">
      <Player
        ref={playerRef}
        component={FlarentVideo}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        compositionWidth={canvas.width}
        compositionHeight={canvas.height}
        fps={canvas.fps}
        style={{ width: '100%', height: '100%' }}
        loop
        acknowledgeRemotionLicense
      />
    </div>
  );
};
