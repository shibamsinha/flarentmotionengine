import React, { useCallback, useRef, useState } from 'react';
import type { PaletteName, Scene } from '../../types/scene';
import { themeFor, type FieldOverrides } from '../../utils/typography';
import { CANVAS, buildTimeline, totalFrames } from '../../utils/timing';
import type { ProjectAudio } from '../../types/audio';
import { cachedWaveform } from '../../utils/waveform';

/** Tick spacing that keeps the ruler readable at any reel length. */
const tickStep = (seconds: number): number => {
  if (seconds <= 6) return 1;
  if (seconds <= 15) return 2;
  if (seconds <= 40) return 5;
  return 10;
};

export const Timeline: React.FC<{
  scenes: Scene[];
  palette: PaletteName;
  fields: FieldOverrides;
  frame: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSeek: (frame: number) => void;
  /** V7 — drawn as its own lane under the scenes, in project time. */
  audio?: ProjectAudio | null;
}> = ({ scenes, palette, fields, frame, selectedId, onSelect, onSeek, audio }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const timeline = buildTimeline(scenes, CANVAS.fps);
  const frames = totalFrames(scenes, CANVAS.fps);
  const seconds = frames / CANVAS.fps;
  const step = tickStep(seconds);

  const ticks: number[] = [];
  for (let t = 0; t <= seconds + 0.001; t += step) ticks.push(t);

  /** Pointer x over the track → the exact frame under it. */
  const frameAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(frames - 1, Math.round(ratio * frames)));
    },
    [frames],
  );

  /**
   * Scrubbing selects the scene under the playhead as well as seeking, so the
   * controls panel always shows whatever is on screen.
   */
  const seekTo = useCallback(
    (target: number) => {
      onSeek(target);
      const entry = timeline.find(
        (candidate) =>
          target >= candidate.from && target < candidate.from + candidate.durationInFrames,
      );
      if (entry && entry.scene.id !== selectedId) onSelect(entry.scene.id);
    },
    [onSeek, onSelect, selectedId, timeline],
  );

  const handleDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      // Capture keeps the scrub alive when the pointer leaves the track. It is
      // best-effort: a synthetic or already-released pointer id throws here, and
      // that must not abort the seek.
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        /* scrubbing still works, just not outside the track */
      }
      setScrubbing(true);
      seekTo(frameAt(event.clientX));
    },
    [frameAt, seekTo],
  );

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      setHover(frameAt(event.clientX));
      if (!scrubbing) return;
      seekTo(frameAt(event.clientX));
    },
    [frameAt, seekTo, scrubbing],
  );

  const stop = useCallback(() => setScrubbing(false), []);

  const timecode = (f: number): string => {
    const total = f / CANVAS.fps;
    const whole = Math.floor(total);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(Math.round((total - whole) * 100)).padStart(2, '0')}`;
  };

  return (
    <div>
      <div
        ref={trackRef}
        className={`timeline${scrubbing ? ' is-scrubbing' : ''}`}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={frames}
        aria-valuenow={frame}
        tabIndex={0}
      >
        {timeline.map((entry) => {
          const theme = themeFor(entry.scene.background, palette, fields);
          const share = entry.durationInFrames / frames;
          return (
            <div
              key={entry.scene.id}
              className={`timeline-seg${
                entry.scene.id === selectedId ? ' is-active' : ''
              }`}
              style={{ flex: `${share} 1 0` }}
              title={`${entry.scene.text.replace(/\n/g, ' / ')} · ${entry.durationInSeconds.toFixed(2)}s`}
            >
              <span
                className="seg-fill"
                style={{
                  background: theme.background,
                  opacity: entry.scene.id === selectedId ? 1 : 0.72,
                }}
              />
              <span className="seg-label">
                {String(entry.index + 1).padStart(2, '0')}
              </span>
            </div>
          );
        })}

        {hover !== null && !scrubbing ? (
          <span
            className="hover-line"
            style={{ left: `${(hover / frames) * 100}%` }}
          >
            <span className="hover-time">{timecode(hover)}</span>
          </span>
        ) : null}

        <span
          className="playhead"
          style={{ left: `${Math.min(100, (frame / frames) * 100)}%` }}
        >
          <span className="playhead-grip" />
        </span>
      </div>

      {/*
        The audio lane.

        One bar across the whole timeline rather than a slice inside each scene
        card, because the track is positioned in *project* time and belongs to
        no scene. Re-timing a scene slides the segments above this bar; the bar
        itself does not move, which is the invariant made visible.

        Peaks come from the cache only — never computed here. This component
        re-renders on every frame during playback, and decoding audio in that
        path is exactly the lag the brief warns about.
      */}
      {audio ? (() => {
        const clipStart = Math.max(0, audio.timelineStart);
        const selected = Math.max(0, audio.sourceEnd - audio.sourceStart);
        const clipLength = Math.max(0, Math.min(selected, seconds - clipStart));
        if (clipLength <= 0 || seconds <= 0) return null;

        const wave = cachedWaveform(
          /^(https?:)?\/\//.test(audio.src) ? audio.src : `/${audio.src}`,
        );
        // The slice of the file the selection actually uses.
        const bars = wave && wave.duration > 0
          ? (() => {
              const from = Math.floor((audio.sourceStart / wave.duration) * wave.peaks.length);
              const to = Math.ceil((audio.sourceEnd / wave.duration) * wave.peaks.length);
              return wave.peaks.slice(Math.max(0, from), Math.max(from + 1, to));
            })()
          : null;

        return (
          <div className="timeline-audio">
            <span
              className="timeline-audio-clip"
              style={{
                left: `${(clipStart / seconds) * 100}%`,
                width: `${(clipLength / seconds) * 100}%`,
              }}
            >
              {bars
                ? bars.map((peak, i) => (
                    <span
                      key={i}
                      className="timeline-audio-peak"
                      style={{ height: `${Math.max(12, peak * 100)}%` }}
                    />
                  ))
                : null}
            </span>
            {!bars ? (
              <span className="timeline-audio-label">
                {audio.muted ? 'audio · muted' : 'audio'}
              </span>
            ) : null}
          </div>
        );
      })() : null}

      <div className="ruler">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / seconds) * 100}%` }}>
            {t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}s`}
          </span>
        ))}
      </div>
    </div>
  );
};
