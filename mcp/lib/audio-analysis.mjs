/**
 * Audio analysis — duration, onsets, tempo and beats, in Node.
 *
 * **Why this exists rather than reusing the editor's.** `src/utils/waveform.ts`
 * is browser-only: it builds an `<audio>` element and calls
 * `AudioContext.decodeAudioData`. Neither exists in Node, so the MCP server
 * cannot call it. This is not a second audio *system* — the project's audio
 * model, trimming and playback stay exactly where they were. It is the decode
 * step the browser gave the editor for free, done with the tools Node has.
 *
 * **No new dependency.** Decoding goes through the ffmpeg binary Remotion
 * already ships (falling back to one on PATH), and everything after that is
 * arithmetic in this file: an FFT, spectral flux, autocorrelation.
 *
 * **How accurate is it?** Honestly: it is a good estimate on music with a clear
 * percussive pulse and a poor one on rubato, ambient or speech. So every result
 * is labelled `estimated`, carries a `confidence`, and says which method
 * produced it. Nothing here is presented as ground truth, because §8 of the
 * brief is right that claiming otherwise would be worse than not offering it.
 *
 * The pipeline, all deterministic — the same file always yields the same numbers:
 *
 *   ffmpeg → mono 22.05kHz float PCM
 *        → STFT (1024-sample Hann window, 256 hop → 86.1 frames/sec)
 *        → spectral flux (positive magnitude change, summed over bins)
 *        → adaptive-threshold onset envelope
 *        → autocorrelation over 60–200 BPM → period
 *        → comb-filter phase search → beat grid
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR, ROOT } from './engine.mjs';
import { unavailable, validationError } from './errors.mjs';

const CACHE_DIR = path.join(DATA_DIR, 'analysis');

/* Analysis constants. Chosen once, documented, and never tuned per file — a
   result that depends on hidden per-run choices is not reproducible. */
const SAMPLE_RATE = 22050;   // Enough for onsets; a quarter of the samples of 44.1k.
const WINDOW = 1024;         // ~46ms — long enough to resolve bass, short enough to be sharp.
const HOP = 256;             // ~11.6ms between frames.
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Refuse to decode more than this; a long file would otherwise pin memory. */
const MAX_SECONDS = 15 * 60;

/* ------------------------------------------------------------------ ffmpeg */

let resolved = null;

/**
 * Find an ffmpeg that actually runs here.
 *
 * Two traps, both hit on this machine and both worth stating:
 *
 *  - **Remotion's binary needs its own directory on the dynamic-library path.**
 *    Its `libavdevice` and friends sit beside it and are not found otherwise, so
 *    it fails at load with a `dyld` error that looks like a missing install.
 *  - **It can be built for a newer OS than the host.** The Remotion CLI warns
 *    about this ("your macOS version is older than macOS 15"), and the binary
 *    then refuses to start.
 *
 * So a candidate is not trusted because the file exists — it is *run* first, and
 * rejected if it cannot report its own version. Whatever is on PATH is the
 * fallback, which is what makes this work on a machine where the bundled build
 * is unusable.
 */
export const resolveFfmpeg = () => {
  if (resolved) return resolved;

  const bundledDir = path.join(
    ROOT, 'node_modules', '@remotion',
    // The Windows package carries a toolchain suffix: compositor-win32-x64-msvc.
    `compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`,
  );

  const candidates = [
    {
      bin: path.join(bundledDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      // Both names, so one branch covers macOS and Linux.
      env: { ...process.env, DYLD_LIBRARY_PATH: bundledDir, LD_LIBRARY_PATH: bundledDir },
      label: 'bundled with Remotion',
    },
    { bin: 'ffmpeg', env: process.env, label: 'on PATH' },
  ];

  const failures = [];
  for (const candidate of candidates) {
    if (candidate.bin.includes(path.sep) && !fs.existsSync(candidate.bin)) {
      failures.push(`${candidate.label}: not installed`);
      continue;
    }
    const probe = spawnSync(candidate.bin, ['-version'], { env: candidate.env, encoding: 'utf8' });
    if (probe.status === 0) {
      resolved = candidate;
      return resolved;
    }
    failures.push(`${candidate.label}: ${(probe.stderr || probe.error?.message || 'failed to start').split('\n')[0]}`);
  }

  throw unavailable(
    `No usable ffmpeg found. Tried — ${failures.join('; ')}. Install ffmpeg on PATH ` +
      '(e.g. `brew install ffmpeg`) to enable audio analysis.',
  );
};

/**
 * Parse a RIFF/WAVE buffer into mono float samples.
 *
 * Chunks are walked rather than assuming the classic 44-byte header: ffmpeg
 * writes a `LIST` chunk before `data` often enough that a fixed offset reads
 * metadata as audio, which shows up as a burst of noise at t=0 and a confidently
 * wrong onset.
 */
const parseWav = (buffer) => {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw validationError('ffmpeg produced something that is not a WAV stream.');
  }

  let bitsPerSample = 16;
  let formatTag = 1;
  let offset = 12;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      formatTag = buffer.readUInt16LE(body);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
      break;
    }
    // Chunks are word-aligned, so an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (!data) throw validationError('The decoded WAV stream has no data chunk.');

  if (formatTag === 3 && bitsPerSample === 32) {
    const samples = new Float32Array(data.length >> 2);
    for (let i = 0; i < samples.length; i++) samples[i] = data.readFloatLE(i * 4);
    return samples;
  }
  if (bitsPerSample === 16) {
    const samples = new Float32Array(data.length >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
    return samples;
  }

  throw validationError(
    `Unsupported PCM format from ffmpeg (${bitsPerSample}-bit, tag ${formatTag}).`,
  );
};

/**
 * Decode to mono 22.05kHz.
 *
 * WAV rather than a raw `f32le` stream because Remotion's ffmpeg is a reduced
 * build whose only relevant muxer is `wav` — raw PCM output fails there with
 * "Requested output format is not known". WAV works with both that build and a
 * full system ffmpeg, so there is one code path instead of two.
 */
const decodePcm = (file) => {
  const { bin, env } = resolveFfmpeg();
  let raw;
  try {
    raw = execFileSync(
      bin,
      [
        '-v', 'error',
        '-i', file,
        '-t', String(MAX_SECONDS),
        '-vn',
        '-f', 'wav',
        '-acodec', 'pcm_s16le',
        '-ac', '1',
        '-ar', String(SAMPLE_RATE),
        '-',
      ],
      { env, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim().split('\n').pop() : error.message;
    throw validationError(`ffmpeg could not decode this audio file: ${detail}`, { file: path.basename(file) });
  }

  return parseWav(raw);
};

/* --------------------------------------------------------------------- FFT */

/** In-place iterative radix-2 Cooley–Tukey. `re`/`im` must be a power of two. */
const fft = (re, im) => {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const xr = re[i + j + half];
        const xi = im[i + j + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
};

/* ---------------------------------------------------------- onset envelope */

/**
 * Spectral flux: how much the spectrum *grew* between consecutive frames.
 *
 * Only positive change counts. A note starting adds energy across many bins at
 * once; a note ending removes it, and counting that too would put an onset at
 * the end of every note as well as the start.
 */
const onsetEnvelope = (samples) => {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  if (frames < 4) return { flux: new Float32Array(0), frames: 0 };

  // Hann window, precomputed once — it is the same for every frame.
  const window = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
  }

  const bins = WINDOW >> 1;
  const flux = new Float32Array(frames);
  let previous = new Float32Array(bins);
  const re = new Float32Array(WINDOW);
  const im = new Float32Array(WINDOW);

  for (let f = 0; f < frames; f++) {
    const offset = f * HOP;
    for (let i = 0; i < WINDOW; i++) {
      re[i] = samples[offset + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);

    let sum = 0;
    const current = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      // Log magnitude compresses the dynamic range, so a loud chorus does not
      // drown out the verse's onsets entirely.
      const magnitude = Math.log1p(Math.hypot(re[b], im[b]));
      current[b] = magnitude;
      const delta = magnitude - previous[b];
      if (delta > 0) sum += delta;
    }
    flux[f] = sum;
    previous = current;
  }

  return { flux, frames };
};

/**
 * Subtract a local mean so the envelope is comparable across a whole track.
 *
 * Without this a quiet intro contributes almost nothing and every detected beat
 * lands in the loudest section.
 */
const adaptiveThreshold = (flux, radius = 8) => {
  const out = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(flux.length, i + radius + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += flux[j];
    out[i] = Math.max(0, flux[i] - sum / (to - from));
  }
  return out;
};

/* -------------------------------------------------------------------- tempo */

/**
 * Autocorrelation over the plausible tempo range.
 *
 * Returns the best period in frames plus a confidence: the peak's height over
 * the mean correlation, squashed into 0..1. A track with a strong regular pulse
 * scores high; ambient material scores low, which is exactly the signal a
 * caller needs to decide whether to trust the beats.
 */
const estimateTempo = (envelope, framesPerSecond) => {
  const minLag = Math.floor((60 / MAX_BPM) * framesPerSecond);
  const maxLag = Math.ceil((60 / MIN_BPM) * framesPerSecond);
  if (envelope.length < maxLag * 2) return null;

  let bestLag = 0;
  let bestScore = -Infinity;
  let total = 0;
  let count = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < envelope.length; i++) sum += envelope[i] * envelope[i + lag];
    const score = sum / (envelope.length - lag);
    total += score;
    count += 1;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag === 0) return null;
  const mean = total / count;
  const confidence = mean > 0 ? Math.min(1, Math.max(0, (bestScore / mean - 1) / 2)) : 0;

  let bpm = (60 * framesPerSecond) / bestLag;

  /* Octave correction. Autocorrelation happily locks onto half or double the
     musical tempo; nudging into 90–180 BPM picks the reading a listener would
     agree with far more often than not. It is a heuristic, and it is one reason
     the result is labelled "estimated". */
  let period = bestLag;
  while (bpm < 90 && bpm * 2 <= MAX_BPM) { bpm *= 2; period /= 2; }
  while (bpm > 180 && bpm / 2 >= MIN_BPM) { bpm /= 2; period *= 2; }

  return { period, bpm, confidence };
};

/**
 * Find the phase that best lines a fixed-period grid up with the onsets, then
 * lay the grid down.
 *
 * A comb filter rather than a dynamic-programming tracker: it cannot follow a
 * tempo that drifts, but it is short, fully deterministic, and it does not
 * pretend to more precision than the confidence score admits.
 */
const layBeats = (envelope, period, framesPerSecond, durationSeconds) => {
  const whole = Math.max(1, Math.round(period));
  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let phase = 0; phase < whole; phase++) {
    let score = 0;
    for (let i = phase; i < envelope.length; i += whole) score += envelope[i];
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  const beats = [];
  for (let frame = bestPhase; frame < envelope.length; frame += whole) {
    const time = frame / framesPerSecond;
    if (time > durationSeconds) break;
    beats.push({
      time: Number(time.toFixed(3)),
      // Local strength, so "the strongest beat" is answerable. Normalised
      // below once the maximum across all beats is known.
      strength: envelope[frame],
    });
  }

  const loudest = beats.reduce((max, beat) => Math.max(max, beat.strength), 0);
  return beats.map((beat) => ({
    time: beat.time,
    strength: Number((loudest > 0 ? beat.strength / loudest : 0).toFixed(3)),
  }));
};

/* ------------------------------------------------------------------ public */

/**
 * Duration without a full decode.
 *
 * ffprobe first: it prints the number and nothing else. The ffmpeg fallback
 * parses the `Duration:` banner instead, and note that it deliberately does
 * *not* pass `-v error` — that flag suppresses the very line being parsed,
 * which is a quiet way to make every duration read come back null.
 */
export const readDuration = (file) => {
  const { bin, env } = resolveFfmpeg();

  const probe = bin.includes(path.sep)
    ? path.join(path.dirname(bin), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    : 'ffprobe';

  if (!bin.includes(path.sep) || fs.existsSync(probe)) {
    const result = spawnSync(
      probe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { env, encoding: 'utf8' },
    );
    const seconds = Number(String(result.stdout ?? '').trim());
    if (result.status === 0 && Number.isFinite(seconds) && seconds > 0) return seconds;
  }

  const result = spawnSync(bin, ['-hide_banner', '-i', file, '-f', 'null', '-'], {
    env, encoding: 'utf8',
  });
  const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(result.stderr ?? '');
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

/**
 * A previously computed analysis, or null — never a fresh decode.
 *
 * The `inspect_*` tools use this so that orienting yourself in a project stays
 * cheap. A read that silently costs a full STFT would make a model reluctant to
 * look before it edits, which is the opposite of what inspection is for.
 */
export const cachedAnalysis = async (file) => {
  try {
    const bytes = await fsp.readFile(file);
    const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const cacheFile = path.join(CACHE_DIR, `${hash}.json`);
    if (!fs.existsSync(cacheFile)) return null;
    return JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Analyse a file, cached by content hash.
 *
 * Cached because a full decode plus STFT of a three-minute track is seconds of
 * work, and `sync_to_beats` will be called repeatedly against the same track
 * while a model iterates on the edit.
 */
export const analyzeAudio = async (file, { force = false } = {}) => {
  if (!fs.existsSync(file)) {
    throw validationError(`No audio file at ${file}.`, { file });
  }

  const bytes = await fsp.readFile(file);
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const cacheFile = path.join(CACHE_DIR, `${hash}.json`);

  if (!force && fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
    } catch {
      // Fall through and recompute over a corrupt cache entry.
    }
  }

  const samples = decodePcm(file);
  const durationSeconds = samples.length / SAMPLE_RATE;
  if (durationSeconds <= 0) {
    throw validationError('That file decodes to no audio at all.', { file: path.basename(file) });
  }

  const framesPerSecond = SAMPLE_RATE / HOP;
  const { flux, frames } = onsetEnvelope(samples);

  let result;
  if (frames < 8) {
    // Too short to have a tempo. Report the duration truthfully and say so
    // rather than returning a fabricated BPM.
    result = {
      duration: Number(durationSeconds.toFixed(3)),
      sampleRate: SAMPLE_RATE,
      bpm: null,
      confidence: 0,
      quality: 'estimated',
      method: 'spectral-flux + autocorrelation',
      beats: [],
      note: 'Too short to estimate a tempo.',
    };
  } else {
    const envelope = adaptiveThreshold(flux);
    const tempo = estimateTempo(envelope, framesPerSecond);

    result = tempo
      ? {
          duration: Number(durationSeconds.toFixed(3)),
          sampleRate: SAMPLE_RATE,
          bpm: Number(tempo.bpm.toFixed(2)),
          confidence: Number(tempo.confidence.toFixed(3)),
          quality: 'estimated',
          method: 'spectral-flux + autocorrelation + comb-filter phase',
          beats: layBeats(envelope, tempo.period, framesPerSecond, durationSeconds),
        }
      : {
          duration: Number(durationSeconds.toFixed(3)),
          sampleRate: SAMPLE_RATE,
          bpm: null,
          confidence: 0,
          quality: 'estimated',
          method: 'spectral-flux + autocorrelation',
          beats: [],
          note: 'No periodic pulse found — the track may be ambient, rubato or speech.',
        };
  }

  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fsp.writeFile(cacheFile, JSON.stringify(result));
  return result;
};

export { SAMPLE_RATE, MIN_BPM, MAX_BPM };
