/**
 * V7 — the project's audio track.
 *
 * **Audio belongs to the project, not to a scene.** It sits beside `scenes` in
 * the project model and beside `<Series>` in the composition, exactly as the
 * static overlay does. That position is the feature: a scene cannot restart it
 * at a boundary, re-time it, or take it away, because it was never inside a
 * scene to begin with. Changing a scene's duration moves the scenes around
 * underneath it and leaves the audio where it was.
 *
 * **Two independent ranges, deliberately not conflated.**
 *
 *   SOURCE    which part of the file is used     sourceStart → sourceEnd
 *   TIMELINE  where in the video it plays        timelineStart → …
 *
 * A user picking 1:28–1:47 of a three-minute song and dropping it at 0s of a
 * twenty-second video is setting both, and they are different numbers. Storing
 * only an offset and a length would make "move it later without re-trimming"
 * impossible to express.
 *
 * Everything is in **seconds**, not frames. Frames are the renderer's unit;
 * seconds are the user's, and the project's own `duration` is already in
 * seconds, so this matches.
 */

export type ProjectAudio = {
  /**
   * A path inside `public/` (what the upload endpoint returns) or an absolute
   * http(s) URL — the same convention `SceneImage` and `OverlayImage` use, so
   * asset handling is shared rather than reinvented.
   */
  src: string;
  /** Original filename, for the editor to show. Not used in rendering. */
  name?: string;
  /**
   * Length of the whole file in seconds, read once at import. Needed to draw
   * the trim UI against the full file rather than only the selection.
   */
  sourceDuration?: number;

  /** Seconds into the source file where the selection starts. */
  sourceStart: number;
  /** Seconds into the source file where the selection ends. */
  sourceEnd: number;

  /**
   * Seconds into the *project* where the selection begins playing. 0 means the
   * audio starts with the video. Kept separate from the source range so a clip
   * can be moved without being re-trimmed.
   */
  timelineStart: number;

  /** 0..1. Applied in the editor preview and in the render alike. */
  volume: number;
  /** Silences without discarding the volume setting. */
  muted?: boolean;

  /** Seconds. 0 or absent means no fade. */
  fadeIn?: number;
  fadeOut?: number;

  /**
   * Off by default, and deliberately so: silently looping someone's music to
   * fill a longer video is a decision the engine should not make on its own.
   */
  loop?: boolean;
};

/** Formats the browser and Chrome's renderer both decode reliably. */
export const AUDIO_MIME: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'audio/flac': '.flac',
};

export const AUDIO_EXTENSIONS = [
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.weba', '.webm', '.flac',
];

/** The selection's length in seconds. Never negative. */
export const audioSelectionLength = (audio: ProjectAudio): number =>
  Math.max(0, audio.sourceEnd - audio.sourceStart);

/**
 * A sensible default selection for a freshly imported file.
 *
 * Starts at the beginning and takes either the whole file or exactly as much as
 * the video can use — there is no point selecting three minutes of audio for a
 * twenty-second reel, and a selection longer than the video is the one case
 * where the extra is silently discarded at render time.
 */
export const defaultSelection = (
  sourceDuration: number,
  videoSeconds: number,
): { sourceStart: number; sourceEnd: number } => ({
  sourceStart: 0,
  sourceEnd: Math.min(sourceDuration, Math.max(videoSeconds, 0.1)),
});
