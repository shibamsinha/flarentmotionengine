import React, { useEffect, useMemo } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { FlarentVideo } from '../../compositions/FlarentVideo';
import type { OverlayImage, PaletteName, Scene } from '../../types/scene';
import type { FieldOverrides } from '../../utils/typography';
import { CANVAS, totalFrames } from '../../utils/timing';

export const VideoPreview: React.FC<{
  scenes: Scene[];
  palette: PaletteName;
  fields: FieldOverrides;
  overlay: OverlayImage | null;
  playerRef: React.RefObject<PlayerRef | null>;
  onFrame: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
}> = ({ scenes, palette, fields, overlay, playerRef, onFrame, onPlayingChange }) => {
  const durationInFrames = totalFrames(scenes, CANVAS.fps);
  const inputProps = useMemo(
    () => ({ scenes, palette, fields, ...(overlay ? { overlay } : {}) }),
    [scenes, palette, fields, overlay],
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
        compositionWidth={CANVAS.width}
        compositionHeight={CANVAS.height}
        fps={CANVAS.fps}
        style={{ width: '100%', height: '100%' }}
        loop
        acknowledgeRemotionLicense
      />
    </div>
  );
};
