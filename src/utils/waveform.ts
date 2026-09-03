/**
 * V7 — reading an audio file's shape.
 *
 * Two jobs, and they cost very different amounts:
 *
 *  - **Duration.** Cheap. An `<audio>` element reports it from the header
 *    without decoding a sample, so this is what runs on import and what the
 *    trim UI is laid out against.
 *  - **Peaks.** Expensive. `decodeAudioData` decompresses the whole file into
 *    memory — several hundred megabytes for a long WAV — so it happens once,
 *    off the import path, and the result is cached by source.
 *
 * The peaks array is deliberately small and resolution-independent: a fixed
 * number of buckets across the whole file, each holding the loudest sample in
 * its slice. Drawing is then a cheap loop over a few hundred numbers, which is
 * what keeps the waveform from re-costing anything during playback. The brief
 * is explicit about not recomputing this while the playhead moves.
 */

/** Buckets across the whole file. ~1.5px each at a typical panel width. */
const BUCKETS = 480;

export type Waveform = {
  /** Peak amplitude 0..1, one per bucket, spanning the whole file. */
  peaks: number[];
  /** Seconds. */
  duration: number;
};

/**
 * Duration without decoding.
 *
 * Rejects rather than resolving to 0 on failure, because "this file is zero
 * seconds long" and "this file could not be read" need different messages and
 * conflating them produces a trim UI with no range and no explanation.
 */
export const readAudioDuration = (src: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    const done = () => {
      el.removeAttribute('src');
      el.load();
    };
    el.onloadedmetadata = () => {
      const seconds = el.duration;
      done();
      if (!Number.isFinite(seconds) || seconds <= 0) {
        reject(new Error('The file reports no playable duration.'));
        return;
      }
      resolve(seconds);
    };
    el.onerror = () => {
      done();
      reject(new Error('The browser could not decode this audio file.'));
    };
    el.src = src;
  });

/**
 * Cached by source URL. A project has one track, and the editor re-renders
 * constantly; decoding on every render would make the panel unusable.
 *
 * Deliberately unbounded — one entry per audio file a session has opened, each
 * a few hundred numbers.
 */
const cache = new Map<string, Waveform>();

export const cachedWaveform = (src: string): Waveform | null =>
  cache.get(src) ?? null;

export const computeWaveform = async (src: string): Promise<Waveform> => {
  const hit = cache.get(src);
  if (hit) return hit;

  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not read the audio file (${response.status}).`);
  const bytes = await response.arrayBuffer();

  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) throw new Error('This browser has no Web Audio support.');

  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    const channel = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(channel.length / BUCKETS));
    const peaks: number[] = [];

    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      const start = bucket * per;
      let peak = 0;
      // Stride rather than reading every sample: at 44.1kHz a bucket can hold
      // 20k samples and the loudest of every 16th is visually identical.
      for (let i = start; i < Math.min(start + per, channel.length); i += 16) {
        const value = channel[i] < 0 ? -channel[i] : channel[i];
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }

    // Normalise so a quiet recording still fills the panel — this is a picture
    // of the shape, not a level meter.
    const loudest = peaks.reduce((max, p) => (p > max ? p : max), 0);
    const scale = loudest > 0.01 ? 1 / loudest : 1;

    const waveform: Waveform = {
      peaks: peaks.map((p) => Math.min(1, p * scale)),
      duration: buffer.duration,
    };
    cache.set(src, waveform);
    return waveform;
  } finally {
    // Chrome caps concurrent AudioContexts; leaking one per import would
    // eventually stop decoding entirely.
    void ctx.close();
  }
};

/** mm:ss.cc — precise enough to trim against, still readable. */
export const timecode = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const whole = Math.floor(seconds);
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  const cs = String(Math.round((seconds - whole) * 100)).padStart(2, '0');
  return `${mm}:${ss}.${cs}`;
};

/** mm:ss — for durations, where hundredths are noise. */
export const shortTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
