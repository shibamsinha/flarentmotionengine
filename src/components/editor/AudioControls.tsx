/**
 * V7 — the project's audio track.
 *
 * Sits with the other project-level controls, not inside a scene's panel,
 * because that is what the audio *is*. The brief calls this non-negotiable and
 * the UI has to say it as plainly as the data model does: there is one track,
 * it is listed once, and no scene shows an audio control at all.
 *
 * The waveform is the trim UI. Two handles over a picture of the file is the
 * whole interaction — drag an edge to change the selection, drag the middle to
 * move it, and the selected span is the audio the video gets. Times are shown
 * to hundredths because trimming to a beat needs that; everything else is
 * rounded.
 *
 * There is deliberately no play button here. Audio plays through the project's
 * own transport, from the same clock as the visuals — a second play button on
 * this panel would imply a second playback state, which is exactly the split
 * the brief warns against. What this panel does offer is scrubbing the main
 * playhead to where the audio starts, which is the thing you actually want when
 * checking a trim.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectAudio } from '../../types/audio';
import { AUDIO_EXTENSIONS, defaultSelection } from '../../types/audio';
import {
  cachedWaveform,
  computeWaveform,
  readAudioDuration,
  shortTime,
  timecode,
  type Waveform,
} from '../../utils/waveform';

/** Same resolution as the upload endpoint's: a bare path is a `public/` asset. */
const assetUrl = (src: string): string =>
  /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : `/${src}`;

type Drag = { kind: 'start' | 'end' | 'move'; grabbedAt: number; startSel: { a: number; b: number } };

const WaveformStrip: React.FC<{
  audio: ProjectAudio;
  wave: Waveform | null;
  onChange: (patch: Partial<ProjectAudio>) => void;
}> = ({ audio, wave, onChange }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const total = wave?.duration ?? audio.sourceDuration ?? 0;

  const secondsAt = useCallback(
    (clientX: number): number => {
      const host = hostRef.current;
      if (!host || total <= 0) return 0;
      const rect = host.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(total, ratio * total));
    },
    [total],
  );

  const onPointerDown = (event: React.PointerEvent, kind: Drag['kind']) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId);
    } catch {
      /* dragging still works within the element */
    }
    dragRef.current = {
      kind,
      grabbedAt: secondsAt(event.clientX),
      startSel: { a: audio.sourceStart, b: audio.sourceEnd },
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || total <= 0) return;
    const at = secondsAt(event.clientX);
    // A selection shorter than this is not a trim, it is a mis-click.
    const MIN = 0.2;

    if (drag.kind === 'start') {
      onChange({ sourceStart: Math.min(at, audio.sourceEnd - MIN) });
    } else if (drag.kind === 'end') {
      onChange({ sourceEnd: Math.max(at, audio.sourceStart + MIN) });
    } else {
      // Moving keeps the length and clamps at both ends, so dragging past the
      // edge parks the selection against it rather than shrinking it.
      const length = drag.startSel.b - drag.startSel.a;
      const shift = at - drag.grabbedAt;
      const start = Math.max(0, Math.min(total - length, drag.startSel.a + shift));
      onChange({ sourceStart: start, sourceEnd: start + length });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const pct = (seconds: number) => (total > 0 ? (seconds / total) * 100 : 0);

  return (
    <div
      ref={hostRef}
      className="wave"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {wave ? (
        <div className="wave-bars" aria-hidden>
          {wave.peaks.map((peak, i) => (
            <span
              key={i}
              className="wave-bar"
              // Floored so a near-silent passage still shows a line rather
              // than a gap that reads as missing data.
              style={{ height: `${Math.max(4, peak * 100)}%` }}
            />
          ))}
        </div>
      ) : (
        <p className="wave-pending">Reading waveform…</p>
      )}

      {total > 0 ? (
        <>
          {/* The unselected parts are dimmed rather than hidden — you need to
              see what you are not using to know where to drag. */}
          <span className="wave-mask" style={{ left: 0, width: `${pct(audio.sourceStart)}%` }} />
          <span
            className="wave-mask"
            style={{ left: `${pct(audio.sourceEnd)}%`, right: 0 }}
          />
          <span
            className="wave-sel"
            style={{
              left: `${pct(audio.sourceStart)}%`,
              width: `${Math.max(0, pct(audio.sourceEnd) - pct(audio.sourceStart))}%`,
            }}
            onPointerDown={(e) => onPointerDown(e, 'move')}
          >
            <span
              className="wave-handle h-start"
              onPointerDown={(e) => onPointerDown(e, 'start')}
            />
            <span
              className="wave-handle h-end"
              onPointerDown={(e) => onPointerDown(e, 'end')}
            />
          </span>
        </>
      ) : null}
    </div>
  );
};

export const AudioControls: React.FC<{
  audio: ProjectAudio | null;
  /** The project's length, so a fresh import can select a useful default. */
  videoSeconds: number;
  onChange: (audio: ProjectAudio | null) => void;
  /** Moves the master playhead — the only playback control this panel needs. */
  onSeekSeconds: (seconds: number) => void;
}> = ({ audio, videoSeconds, onChange, onSeekSeconds }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wave, setWave] = useState<Waveform | null>(null);
  /**
   * The asset is gone — an imported project referencing a file this machine
   * never had, or an upload that has since been cleared. The configuration is
   * still valid and still worth showing; only the sound is missing.
   */
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const src = audio ? assetUrl(audio.src) : null;

  /**
   * Peaks are computed off the import path and cached by source, so switching
   * scenes or nudging a handle never pays for a decode. The cached value is
   * read synchronously first so a re-render does not flash "Reading waveform…".
   */
  useEffect(() => {
    if (!src) {
      setWave(null);
      setMissing(false);
      return;
    }
    let live = true;
    setMissing(false);

    /*
     * Two separate questions, and they fail differently.
     *
     * Can the file be played at all? That is `readAudioDuration`, and a failure
     * there means the asset is missing or undecodable — a real state the user
     * has to be told about, because the export will be silent.
     *
     * Can we draw its shape? That is `computeWaveform`, and a failure there is
     * cosmetic: the trim still works against the stored duration.
     */
    void readAudioDuration(src).then(
      () => { if (live) setMissing(false); },
      () => { if (live) setMissing(true); },
    );

    const hit = cachedWaveform(src);
    if (hit) {
      setWave(hit);
      return;
    }
    setWave(null);
    computeWaveform(src).then(
      (result) => { if (live) setWave(result); },
      () => { if (live) setWave(null); },
    );
    return () => { live = false; };
  }, [src]);

  const importFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(extension) && !file.type.startsWith('audio/')) {
        setError(`${file.name} is not an audio file. Use MP3, WAV, M4A, AAC, OGG or FLAC.`);
        return;
      }

      setBusy('Uploading…');
      try {
        const response = await fetch(
          `/api/upload?kind=audio&name=${encodeURIComponent(file.name)}`,
          { method: 'POST', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? 'Upload failed.');

        setBusy('Reading…');
        // Duration from the header — cheap, and all the trim UI needs to exist.
        const duration = await readAudioDuration(assetUrl(payload.src));

        onChange({
          src: payload.src,
          name: file.name,
          sourceDuration: duration,
          ...defaultSelection(duration, videoSeconds),
          timelineStart: 0,
          volume: 1,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not import that audio.');
      } finally {
        setBusy(null);
      }
    },
    [onChange, videoSeconds],
  );

  const patch = useCallback(
    (next: Partial<ProjectAudio>) => {
      if (!audio) return;
      onChange({ ...audio, ...next });
    },
    [audio, onChange],
  );

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
      hidden
      onChange={(event) => {
        void importFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  if (!audio) {
    return (
      <div className="section">
        <div className="section-head">Audio</div>
        <div className="controls">
          {picker}
          <button
            type="button"
            className="btn wide"
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
          >
            {busy ?? '+ Add audio'}
          </button>
          {error ? <p className="hint is-error">{error}</p> : null}
          <p className="hint">
            One track for the whole video. Trim the part you want; it plays on the
            project timeline and is independent of scene boundaries.
          </p>
        </div>
      </div>
    );
  }

  const total = wave?.duration ?? audio.sourceDuration ?? 0;
  const selected = Math.max(0, audio.sourceEnd - audio.sourceStart);
  // What the video can actually use, which is not always what was selected.
  const usable = Math.max(0, Math.min(selected, videoSeconds - audio.timelineStart));
  const clipped = selected - usable > 0.05;

  return (
    <div className="section">
      <div className="section-head">
        Audio
        <span className="spacer" />
        <span>{shortTime(total)}</span>
      </div>

      <div className="controls">
        {picker}

        <div className="audio-file">
          <span className="audio-name" title={audio.name ?? audio.src}>
            {audio.name ?? audio.src}
          </span>
          <button
            type="button"
            className="btn tiny"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy ?? 'Replace'}
          </button>
          <button type="button" className="btn tiny danger" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>

        {error ? <p className="hint is-error">{error}</p> : null}

        {/*
          Missing asset. The project is not broken — scenes, preview and export
          all still work — so this reports the one thing that is wrong and
          offers the two things that fix it, rather than blocking the editor.
        */}
        {missing ? (
          <p className="hint is-error">
            This audio file could not be loaded. Its settings are kept, but the
            video will export silent until you replace it or remove the track.
          </p>
        ) : null}

        <WaveformStrip audio={audio} wave={wave} onChange={patch} />

        <div className="audio-times">
          <span><b>{timecode(audio.sourceStart)}</b> start</span>
          <span><b>{timecode(audio.sourceEnd)}</b> end</span>
          <span><b>{timecode(selected)}</b> selected</span>
        </div>

        {/*
          The one case worth calling out: a selection the video is too short to
          play all of. Silent truncation would look like a bug in the export.
        */}
        {clipped ? (
          <p className="hint">
            The video is {timecode(videoSeconds)} long, so only the first{' '}
            {timecode(usable)} of this selection will be heard.
          </p>
        ) : null}

        <div className="field-row">
          <div className="field">
            <label>Starts at (s)</label>
            <input
              className="text-input"
              type="number"
              step={0.1}
              min={0}
              value={audio.timelineStart}
              onChange={(e) => patch({ timelineStart: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="field">
            <label>Volume</label>
            <div className="audio-volume">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={audio.volume}
                onChange={(e) => patch({ volume: Number(e.target.value) })}
              />
              <button
                type="button"
                className={`btn tiny${audio.muted ? ' is-on' : ''}`}
                onClick={() => patch({ muted: !audio.muted })}
                title={audio.muted ? 'Unmute' : 'Mute'}
              >
                {audio.muted ? 'Muted' : `${Math.round(audio.volume * 100)}%`}
              </button>
            </div>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Fade in (s)</label>
            <input
              className="text-input"
              type="number"
              step={0.1}
              min={0}
              value={audio.fadeIn ?? 0}
              onChange={(e) => patch({ fadeIn: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
          <div className="field">
            <label>Fade out (s)</label>
            <input
              className="text-input"
              type="number"
              step={0.1}
              min={0}
              value={audio.fadeOut ?? 0}
              onChange={(e) => patch({ fadeOut: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
        </div>

        <div className="chips">
          <button
            type="button"
            className="btn tiny"
            onClick={() => onSeekSeconds(audio.timelineStart)}
            title="Move the playhead to where the audio begins"
          >
            Go to audio start
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() =>
              patch({
                sourceEnd: Math.min(
                  total || audio.sourceEnd,
                  audio.sourceStart + Math.max(0.1, videoSeconds - audio.timelineStart),
                ),
              })
            }
            title="Trim the selection to exactly what the video can play"
          >
            Fit to video
          </button>
        </div>

        <p className="hint">
          Audio plays from the project transport below — one playhead for the
          video and the track together.
        </p>
      </div>
    </div>
  );
};
