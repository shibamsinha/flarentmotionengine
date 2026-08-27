/**
 * Transport controls.
 *
 * The timeline scrubs; this is for the precise moves — stepping a frame at a
 * time to check an entrance, and jumping between scene boundaries. Keyboard
 * shortcuts mirror the buttons and are suppressed while typing, so space in a
 * text field still types a space.
 */

import React, { useEffect } from 'react';
import type { Scene } from '../../types/scene';
import { CANVAS, buildTimeline, totalFrames } from '../../utils/timing';

export const timecodeOf = (frame: number): string => {
  const total = frame / CANVAS.fps;
  const whole = Math.floor(total);
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  const cs = String(Math.round((total - whole) * 100)).padStart(2, '0');
  return `${mm}:${ss}.${cs}`;
};

const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
};

export const Transport: React.FC<{
  scenes: Scene[];
  frame: number;
  playing: boolean;
  onSeek: (frame: number) => void;
  onTogglePlay: () => void;
}> = ({ scenes, frame, playing, onSeek, onTogglePlay }) => {
  const frames = totalFrames(scenes, CANVAS.fps);
  const last = Math.max(0, frames - 1);
  const clamp = (value: number) => Math.max(0, Math.min(last, value));

  const boundaries = React.useMemo(
    () => buildTimeline(scenes, CANVAS.fps).map((entry) => entry.from),
    [scenes],
  );

  const step = React.useCallback(
    (delta: number) => onSeek(clamp(frame + delta)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, onSeek, last],
  );

  const jumpScene = React.useCallback(
    (direction: -1 | 1) => {
      if (direction === -1) {
        // Back to the start of this scene first; a second press goes further.
        const previous = [...boundaries].reverse().find((b) => b < frame - 1);
        onSeek(clamp(previous ?? 0));
      } else {
        const next = boundaries.find((b) => b > frame);
        onSeek(clamp(next ?? last));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundaries, frame, onSeek, last],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const big = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          onTogglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          step(-big);
          break;
        case 'ArrowRight':
          event.preventDefault();
          step(big);
          break;
        case 'ArrowUp':
          event.preventDefault();
          jumpScene(-1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          jumpScene(1);
          break;
        case 'Home':
          event.preventDefault();
          onSeek(0);
          break;
        case 'End':
          event.preventDefault();
          onSeek(last);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTogglePlay, step, jumpScene, onSeek, last]);

  return (
    <div className="transport-group">
      <button
        type="button"
        className="btn icon"
        onClick={() => onSeek(0)}
        title="Start (Home)"
      >
        ⏮
      </button>
      <button
        type="button"
        className="btn icon"
        onClick={() => jumpScene(-1)}
        title="Previous scene (↑)"
      >
        ⇤
      </button>
      <button
        type="button"
        className="btn icon"
        onClick={() => step(-1)}
        title="Back one frame (←, Shift for 10)"
      >
        ◂
      </button>
      <button
        type="button"
        className="btn play"
        onClick={onTogglePlay}
        title="Play / pause (Space)"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="btn icon"
        onClick={() => step(1)}
        title="Forward one frame (→, Shift for 10)"
      >
        ▸
      </button>
      <button
        type="button"
        className="btn icon"
        onClick={() => jumpScene(1)}
        title="Next scene (↓)"
      >
        ⇥
      </button>
      <button
        type="button"
        className="btn icon"
        onClick={() => onSeek(last)}
        title="End (End)"
      >
        ⏭
      </button>

      <span className="timecode">
        <b>{timecodeOf(frame)}</b>
        <span>
          {String(frame).padStart(4, '0')} / {frames}
        </span>
      </span>
    </div>
  );
};
