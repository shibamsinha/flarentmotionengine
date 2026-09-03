/**
 * V7 — the project's audio, inside the composition.
 *
 * This component is the whole synchronisation story, and it works because of
 * *where* it is rather than what it does. Remotion's `<Audio>` is driven by the
 * composition's own frame, so the editor's `<Player>` and the headless
 * `renderMedia` both play it from the same clock they draw the scenes from.
 * There is no second audio clock to drift, no `HTMLAudioElement` to keep in
 * step, and pause/seek/scrub work on the audio for free because they are
 * operations on that one clock.
 *
 * The alternative — an `<audio>` tag in the editor plus a separate audio pass
 * at export — is the thing the brief explicitly warns against, and it would
 * mean the preview and the MP4 could disagree without anything being obviously
 * wrong.
 *
 * Placed as a sibling of `<Series>`, like `OverlayLayer`: it belongs to the
 * project, so it must not live inside a scene's sequence where it would inherit
 * that scene's lifetime and be remounted — which is exactly what "the audio
 * restarts at every scene boundary" looks like.
 */

import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import type { ProjectAudio } from '../../types/audio';

/** Same convention as images: a bare path is a `public/` asset. */
const resolveAudioSrc = (src: string): string =>
  /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : staticFile(src);

export const AudioTrack: React.FC<{
  audio: ProjectAudio;
  fps: number;
  /** The project's length. Audio is clipped to it; it never extends it. */
  durationInFrames: number;
}> = ({ audio, fps, durationInFrames }) => {
  const seconds = (value: number) => Math.round(value * fps);

  const from = Math.max(0, seconds(audio.timelineStart));
  const selection = Math.max(0, seconds(audio.sourceEnd) - seconds(audio.sourceStart));

  /*
   * Clipped to what the video can actually use.
   *
   * Audio longer than the video is truncated; audio shorter than the video
   * simply stops and the video carries on. Neither case stretches anything —
   * the brief is explicit that the video's duration comes from its scenes and
   * audio never changes it. `calculateFlarentMetadata` is untouched by V7 for
   * this reason.
   */
  const available = Math.max(0, durationInFrames - from);
  const playFor = Math.min(selection, available);
  if (playFor <= 0) return null;

  const fadeInFrames = Math.max(0, seconds(audio.fadeIn ?? 0));
  const fadeOutFrames = Math.max(0, seconds(audio.fadeOut ?? 0));
  const base = audio.muted ? 0 : Math.max(0, Math.min(1, audio.volume ?? 1));

  /**
   * Volume as a function of the frame — Remotion evaluates this per frame in
   * the preview and per frame during the render, so a fade is one expression
   * rather than an automation curve the user has to draw.
   *
   * `frame` here is relative to the start of this Sequence, which is what makes
   * the fade-out land at the end of the *clip* rather than the end of the film.
   */
  const volume =
    fadeInFrames === 0 && fadeOutFrames === 0
      ? base
      : (frame: number) => {
          let v = base;
          if (fadeInFrames > 0 && frame < fadeInFrames) {
            v *= frame / fadeInFrames;
          }
          const fromEnd = playFor - frame;
          if (fadeOutFrames > 0 && fromEnd < fadeOutFrames) {
            v *= Math.max(0, fromEnd / fadeOutFrames);
          }
          return Math.max(0, Math.min(1, v));
        };

  return (
    <Sequence from={from} durationInFrames={playFor} layout="none" name="Audio">
      <Audio
        src={resolveAudioSrc(audio.src)}
        // Frames, not seconds — the trim is expressed in the composition's own
        // unit so it cannot round differently from the sequence around it.
        trimBefore={seconds(audio.sourceStart)}
        trimAfter={seconds(audio.sourceEnd)}
        volume={volume}
        loop={audio.loop ?? false}
        /*
         * A missing or unreadable file must not take the render down with it.
         * The editor shows the missing-asset state separately; here the job is
         * simply to keep the visuals rendering.
         */
        onError={(error) => {
          // eslint-disable-next-line no-console
          console.warn('[flarent] audio failed to load:', audio.src, error.message);
        }}
      />
    </Sequence>
  );
};
