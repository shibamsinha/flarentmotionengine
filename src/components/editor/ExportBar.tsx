import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasFormat, OverlayImage, PaletteName, Scene } from '../../types/scene';
import type { FieldOverrides } from '../../utils/typography';
import type { ProjectAudio } from '../../types/audio';
import { CANVAS, totalFrames } from '../../utils/timing';

type Phase = 'idle' | 'starting' | 'browser' | 'bundling' | 'rendering' | 'done' | 'error';

type JobState = {
  phase: Phase;
  progress: number;
  url?: string;
  filename?: string;
  message?: string;
  ms?: number;
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  starting: 'Starting render',
  browser: 'Preparing renderer',
  bundling: 'Bundling composition',
  rendering: 'Rendering frames',
  done: 'Export complete',
  error: 'Export failed',
};

export const ExportBar: React.FC<{
  scenes: Scene[];
  palette: PaletteName;
  format: CanvasFormat;
  fields: FieldOverrides;
  ink: FieldOverrides;
  accent: string | null;
  overlay: OverlayImage | null;
  /** V7 — sent with the render so the MP4 carries the track. */
  audio: ProjectAudio | null;
  saved: boolean;
}> = ({ scenes, palette, format, fields, ink, accent, overlay, audio, saved }) => {
  const [job, setJob] = useState<JobState>({ phase: 'idle', progress: 0 });
  const pollRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const poll = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/render/${jobId}`);
        const data = await response.json();
        setJob({
          phase: data.status as Phase,
          progress: data.progress ?? 0,
          url: data.url,
          filename: data.filename,
          message: data.message,
          ms: data.ms,
        });
        if (data.status === 'done' || data.status === 'error') {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (error) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        setJob({
          phase: 'error',
          progress: 0,
          message: error instanceof Error ? error.message : 'Lost the render server',
        });
      }
    }, 400);
  }, []);

  const exportMp4 = useCallback(async (options?: { silent?: boolean }) => {
    setJob({ phase: 'starting', progress: 0 });
    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * A silent export omits `audio` entirely rather than sending it muted.
         * Muting would still make the renderer decode and mux a silent track —
         * slower, and the file would carry a pointless empty audio stream.
         */
        body: JSON.stringify({
          scenes, palette, format, fields, ink, accent, overlay,
          audio: options?.silent ? null : audio,
        }),
      });
      if (!response.ok) {
        throw new Error(`Render server responded ${response.status}`);
      }
      const { jobId } = await response.json();
      poll(jobId);
    } catch (error) {
      setJob({
        phase: 'error',
        progress: 0,
        message:
          error instanceof Error
            ? `${error.message}. Is the render server running? (npm run dev)`
            : 'Export failed',
      });
    }
  }, [scenes, palette, format, fields, ink, accent, overlay, audio, poll]);

  const busy = ['starting', 'browser', 'bundling', 'rendering'].includes(job.phase);
  const frames = totalFrames(scenes, CANVAS.fps);

  return (
    <div className="export-bar">
      <span className="export-status">
        {(frames / CANVAS.fps).toFixed(2)}s · {frames} frames
      </span>

      <span className={`save-pill${saved ? ' is-saved' : ''}`} title="Work is kept in this browser and restored on reload">
        {saved ? 'Saved' : 'Saving…'}
      </span>

      <span className="spacer" />

      {job.phase !== 'idle' ? (
        <span className={`export-status${job.phase === 'error' ? ' is-error' : ''}`}>
          {busy ? (
            <span className="progress-track">
              <span
                className="progress-fill"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </span>
          ) : null}
          <span>
            {PHASE_LABEL[job.phase]}
            {busy && job.phase === 'rendering'
              ? ` · ${Math.round(job.progress * 100)}%`
              : ''}
            {job.phase === 'done' && job.ms
              ? ` · ${(job.ms / 1000).toFixed(1)}s`
              : ''}
            {job.phase === 'error' && job.message ? ` · ${job.message}` : ''}
          </span>
          {job.phase === 'done' && job.url ? (
            <a href={job.url} download={job.filename}>
              Download {job.filename}
            </a>
          ) : null}
        </span>
      ) : null}

      {/*
        The silent export only appears when there is audio to leave out —
        otherwise it is a second button that does exactly what the first one
        does, which teaches the user that the two are different when they are
        not.
      */}
      {audio ? (
        <button
          type="button"
          className="btn"
          onClick={() => void exportMp4({ silent: true })}
          disabled={busy || scenes.length === 0}
          title="Render the video with the audio track left out"
        >
          Export silent
        </button>
      ) : null}

      <button
        type="button"
        className="btn primary"
        onClick={() => void exportMp4()}
        disabled={busy || scenes.length === 0}
      >
        {busy ? 'Exporting…' : 'Export MP4'}
      </button>
    </div>
  );
};
