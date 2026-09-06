/**
 * Audio tools.
 *
 * Audio is **project-level, never scene-level**, and that is a deliberate part
 * of the engine's design rather than a limitation: the track is positioned on
 * the project clock, so scenes can be re-timed underneath it without the music
 * moving. Anything here that took a `sceneId` would be fighting that.
 *
 * Two ranges, and they are genuinely different numbers — the single most common
 * confusion about this model:
 *
 *   `sourceStart` / `sourceEnd`  which part of the *file* plays
 *   `timelineStart`              where on the *video's* clock it begins
 *
 * Trimming to the chorus is the first pair; delaying the music by half a second
 * is the second. `trim_audio` and `set_audio_offset` are separate tools for
 * exactly that reason.
 *
 * Analysis (tempo, beats) is computed in Node by `lib/audio-analysis.mjs`,
 * because the editor's waveform reader is browser-only and cannot run here. The
 * project's audio model is untouched by it — analysis is read-only and cached
 * beside the project rather than stored in the document.
 */

import { z } from 'zod';

import { analyzeAudio, readDuration } from '../lib/audio-analysis.mjs';
import { discardAsset, importAsset, resolveAssetPath } from '../lib/assets.mjs';
import { confirmationRequired, guard, notFound, ok, validationError } from '../lib/errors.mjs';
import { once } from '../lib/idempotency.mjs';
import { audioSummary, round } from '../lib/summary.mjs';
import { mutateProject, readProject } from '../lib/store.mjs';

/** The project's audio, or a NOT_FOUND that says how to add one. */
const requireAudio = (project) => {
  if (!project.audio) {
    throw notFound('This project has no audio track. Add one with add_audio first.', {
      hasAudio: false,
    });
  }
  return project.audio;
};

export const registerAudioTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  server.registerTool(
    'add_audio',
    {
      title: 'Add audio',
      description:
        'Attach an audio file to the project as its single music track, replacing any ' +
        'existing one. Give the path to a file on this machine (mp3, wav, m4a, aac, ogg or ' +
        'flac); it is copied into the project so renders are reproducible. By default the ' +
        'selection starts at the beginning and runs as long as the video.',
      inputSchema: {
        projectId: s.projectId,
        path: z.string().min(1).describe('Absolute path to an audio file on this machine.'),
        timelineStart: z
          .number()
          .min(0)
          .max(600)
          .optional()
          .describe('Seconds into the video before the music starts. Default 0.'),
        sourceStart: z.number().min(0).max(3600).optional().describe('Where in the file the selection begins.'),
        sourceEnd: z.number().min(0).max(3600).optional().describe('Where in the file the selection ends.'),
        volume: z.number().min(0).max(1).optional().describe('Default 1.'),
        fadeIn: z.number().min(0).max(30).optional(),
        fadeOut: z.number().min(0).max(30).optional(),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('add_audio', args.idempotencyKey, async () => {
        const asset = await importAsset(args.path, 'audio');

        /*
         * The extension said "audio"; ffmpeg is what actually knows. If it
         * cannot find a duration, undo the copy — otherwise a mislabelled file
         * lingers in `public/uploads` and Remotion copies it into every render
         * bundle from here on.
         */
        const sourceDuration = readDuration(asset.absolutePath);
        if (!sourceDuration) {
          await discardAsset(asset);
          throw validationError(
            'That file reports no playable duration — it may be corrupt or not really audio.',
            { path: args.path },
          );
        }

        const stored = await mutateProject(args.projectId, (project) => {
          const canvas = engine.canvasFor(project.format);
          const videoSeconds = engine.totalSeconds(project.scenes, canvas.fps);

          // The engine's own rule for a fresh import: take the whole file, or
          // exactly as much as the video can use.
          const preset = engine.defaultSelection(sourceDuration, videoSeconds);
          const sourceStart = args.sourceStart ?? preset.sourceStart;
          const sourceEnd = args.sourceEnd ?? preset.sourceEnd;

          if (sourceEnd <= sourceStart) {
            throw validationError('sourceEnd must be greater than sourceStart.', {
              sourceStart, sourceEnd,
            });
          }
          if (sourceEnd > sourceDuration + 0.001) {
            throw validationError(
              `sourceEnd ${sourceEnd}s is past the end of a ${round(sourceDuration)}s file.`,
              { sourceDuration: round(sourceDuration) },
            );
          }

          return {
            ...project,
            audio: {
              src: asset.src,
              name: asset.name,
              sourceDuration,
              sourceStart,
              sourceEnd,
              timelineStart: args.timelineStart ?? 0,
              volume: args.volume ?? 1,
              ...(args.fadeIn ? { fadeIn: args.fadeIn } : {}),
              ...(args.fadeOut ? { fadeOut: args.fadeOut } : {}),
            },
          };
        });

        return ok({ audio: audioSummary(stored.project.audio) });
      }),
    ),
  );

  server.registerTool(
    'get_audio',
    {
      title: 'Get audio',
      description:
        'The project\'s audio track: which part of the file is selected, where it sits on ' +
        'the video clock, and its volume and fades. Returns present:false when there is none.',
      inputSchema: { projectId: s.projectId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      return ok({ audio: audioSummary(stored.project.audio) });
    }),
  );

  server.registerTool(
    'trim_audio',
    {
      title: 'Trim audio',
      description:
        'Choose which part of the audio *file* plays, in seconds from the start of the file. ' +
        'This does not move the music on the video timeline — use set_audio_offset for that.',
      inputSchema: {
        projectId: s.projectId,
        sourceStart: z.number().min(0).max(3600).optional(),
        sourceEnd: z.number().min(0).max(3600).optional(),
      },
    },
    guard(async (args) => {
      if (args.sourceStart === undefined && args.sourceEnd === undefined) {
        throw validationError('Pass `sourceStart`, `sourceEnd`, or both.');
      }

      const stored = await mutateProject(args.projectId, (project) => {
        const audio = requireAudio(project);
        const sourceStart = args.sourceStart ?? audio.sourceStart;
        const sourceEnd = args.sourceEnd ?? audio.sourceEnd;

        if (sourceEnd <= sourceStart) {
          throw validationError(
            'sourceEnd must be greater than sourceStart — an empty selection would be silence.',
            { sourceStart, sourceEnd },
          );
        }
        if (audio.sourceDuration && sourceEnd > audio.sourceDuration + 0.001) {
          throw validationError(
            `sourceEnd ${sourceEnd}s is past the end of the ${round(audio.sourceDuration)}s file.`,
            { sourceDuration: round(audio.sourceDuration) },
          );
        }

        return { ...project, audio: { ...audio, sourceStart, sourceEnd } };
      });

      return ok({ audio: audioSummary(stored.project.audio) });
    }),
  );

  server.registerTool(
    'set_audio_offset',
    {
      title: 'Set audio offset',
      description:
        'Move the music on the *video* timeline — how many seconds into the reel it starts. ' +
        'Use this to make a track land on a scene boundary. It does not change which part of ' +
        'the file plays; use trim_audio for that.',
      inputSchema: {
        projectId: s.projectId,
        timelineStart: z.number().min(0).max(600).describe('Seconds into the video.'),
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const audio = requireAudio(project);
        return { ...project, audio: { ...audio, timelineStart: args.timelineStart } };
      });
      return ok({ audio: audioSummary(stored.project.audio) });
    }),
  );

  server.registerTool(
    'update_audio',
    {
      title: 'Update audio',
      description: 'Set volume, fades, mute or loop on the existing track.',
      inputSchema: {
        projectId: s.projectId,
        volume: z.number().min(0).max(1).optional(),
        fadeIn: z.number().min(0).max(30).optional(),
        fadeOut: z.number().min(0).max(30).optional(),
        muted: z.boolean().optional(),
        loop: z.boolean().optional().describe('Repeat the selection to fill the video.'),
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const audio = requireAudio(project);
        const next = { ...audio };
        if (args.volume !== undefined) next.volume = args.volume;
        // Zero and false mean "remove the field", matching how the serialiser
        // omits them — otherwise a fadeIn of 0 would persist as a real fade.
        if (args.fadeIn !== undefined) {
          if (args.fadeIn > 0) next.fadeIn = args.fadeIn; else delete next.fadeIn;
        }
        if (args.fadeOut !== undefined) {
          if (args.fadeOut > 0) next.fadeOut = args.fadeOut; else delete next.fadeOut;
        }
        if (args.muted !== undefined) {
          if (args.muted) next.muted = true; else delete next.muted;
        }
        if (args.loop !== undefined) {
          if (args.loop) next.loop = true; else delete next.loop;
        }
        return { ...project, audio: next };
      });
      return ok({ audio: audioSummary(stored.project.audio) });
    }),
  );

  server.registerTool(
    'remove_audio',
    {
      title: 'Remove audio',
      description:
        'Detach the project\'s audio track. Destructive: requires `confirm: true`. The ' +
        'imported file stays in public/uploads, so re-adding it costs nothing.',
      inputSchema: { projectId: s.projectId, confirm: s.confirm },
      annotations: { destructiveHint: true },
    },
    guard(async (args) => {
      const before = await readProject(args.projectId);
      requireAudio(before.project);
      if (args.confirm !== true) {
        throw confirmationRequired(
          `This removes the audio track "${before.project.audio.name ?? before.project.audio.src}". ` +
            'Re-send with confirm: true to proceed.',
        );
      }
      const stored = await mutateProject(args.projectId, (project) => ({ ...project, audio: null }));
      return ok({ removed: true, audio: audioSummary(stored.project.audio) });
    }),
  );

  /* -------------------------------------------------------------- analysis */

  server.registerTool(
    'analyze_audio',
    {
      title: 'Analyze audio',
      description:
        'Estimate tempo and beat positions for the project\'s audio, by decoding it and ' +
        'running onset detection. Results are ESTIMATED, not ground truth: check ' +
        '`confidence` (0–1) before trusting the beats. It is reliable on music with a clear ' +
        'percussive pulse and unreliable on ambient, rubato or spoken material — in which ' +
        'case bpm comes back null. Cached per file, so calling it repeatedly is cheap.',
      inputSchema: {
        projectId: s.projectId,
        force: z.boolean().optional().describe('Recompute instead of using the cached result.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const audio = requireAudio(stored.project);
      const file = resolveAssetPath(audio.src);
      const analysis = await analyzeAudio(file, { force: args.force === true });

      return ok({
        audio: audioSummary(audio, analysis),
        analysis: {
          duration: analysis.duration,
          sampleRate: analysis.sampleRate,
          bpm: analysis.bpm,
          confidence: analysis.confidence,
          quality: analysis.quality,
          method: analysis.method,
          beatCount: analysis.beats.length,
          ...(analysis.note ? { note: analysis.note } : {}),
        },
      });
    }),
  );

  server.registerTool(
    'get_beats',
    {
      title: 'Get beats',
      description:
        'Beat timestamps for the project\'s audio, in seconds from the start of the FILE. ' +
        'Each carries a `strength` (0–1) so you can find the strongest beat in a range. ' +
        'Use `fromVideoTime`/`toVideoTime` to ask in video-clock terms instead — the tool ' +
        'converts using the track\'s trim and offset, which is the arithmetic most likely to ' +
        'be got wrong by hand.',
      inputSchema: {
        projectId: s.projectId,
        fromVideoTime: z.number().min(0).max(600).optional(),
        toVideoTime: z.number().min(0).max(600).optional(),
        minStrength: z.number().min(0).max(1).optional().describe('Only beats at least this strong.'),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const audio = requireAudio(stored.project);
      const analysis = await analyzeAudio(resolveAssetPath(audio.src));

      /* File time to video time. A beat at file time t is heard at
         `timelineStart + (t - sourceStart)`, and beats outside the selection are
         never heard at all — so they are dropped rather than reported at a
         negative video time. */
      const toVideo = (fileTime) => audio.timelineStart + (fileTime - audio.sourceStart);

      let beats = analysis.beats
        .filter((beat) => beat.time >= audio.sourceStart && beat.time <= audio.sourceEnd)
        .map((beat) => ({
          fileTime: beat.time,
          videoTime: round(toVideo(beat.time)),
          strength: beat.strength,
        }));

      if (args.minStrength !== undefined) {
        beats = beats.filter((beat) => beat.strength >= args.minStrength);
      }
      if (args.fromVideoTime !== undefined) {
        beats = beats.filter((beat) => beat.videoTime >= args.fromVideoTime);
      }
      if (args.toVideoTime !== undefined) {
        beats = beats.filter((beat) => beat.videoTime <= args.toVideoTime);
      }

      const limit = args.limit ?? 100;
      return ok({
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        quality: analysis.quality,
        total: beats.length,
        returned: Math.min(limit, beats.length),
        beats: beats.slice(0, limit),
        ...(beats.length > limit ? { note: `Showing the first ${limit}; narrow the range for more.` } : {}),
      });
    }),
  );

  server.registerTool(
    'sync_to_beats',
    {
      title: 'Sync to beats',
      description:
        'Re-time scene boundaries so cuts land on the beat. State the intent and the engine ' +
        'does the arithmetic — never compute scene durations yourself for this.\n' +
        'Modes: "every-beat" cuts on each beat; "every-n-beats" cuts every N (use 2 or 4 for ' +
        'musical bars); "strongest" cuts on the strongest beats only, which suits a reel with ' +
        'fewer, heavier scenes.\n' +
        'Scene ORDER and content never change — only durations. Durations are clamped to the ' +
        'engine\'s limits and anything clamped is reported back.',
      inputSchema: {
        projectId: s.projectId,
        mode: z
          .enum(['every-beat', 'every-n-beats', 'strongest'])
          .describe('How to choose which beats become scene boundaries.'),
        n: z
          .number()
          .int()
          .min(1)
          .max(16)
          .optional()
          .describe('For every-n-beats: cut every N beats. 4 is one bar in common time.'),
        minStrength: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('For strongest: the strength floor. Default 0.5.'),
        preview: z
          .boolean()
          .optional()
          .describe('True to compute and return the new timing without writing it.'),
      },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const audio = requireAudio(stored.project);
      const analysis = await analyzeAudio(resolveAssetPath(audio.src));

      if (analysis.beats.length === 0) {
        throw validationError(
          `No beats were detected in this track (${analysis.note ?? 'no periodic pulse found'}), ` +
            'so there is nothing to sync to. Set durations directly with set_scene_duration.',
          { bpm: analysis.bpm, confidence: analysis.confidence },
        );
      }

      // Beats as video-clock times, only those actually heard, in order.
      const audible = analysis.beats
        .filter((beat) => beat.time >= audio.sourceStart && beat.time <= audio.sourceEnd)
        .map((beat) => ({
          time: audio.timelineStart + (beat.time - audio.sourceStart),
          strength: beat.strength,
        }))
        .sort((a, b) => a.time - b.time);

      let boundaries;
      if (args.mode === 'every-beat') {
        boundaries = audible;
      } else if (args.mode === 'every-n-beats') {
        const n = args.n ?? 4;
        boundaries = audible.filter((_beat, index) => index % n === 0);
      } else {
        const floor = args.minStrength ?? 0.5;
        boundaries = audible.filter((beat) => beat.strength >= floor);
      }

      // Only boundaries after the reel starts can end a scene.
      boundaries = boundaries.filter((beat) => beat.time > 0.001);

      const sceneCount = stored.project.scenes.length;
      if (boundaries.length < sceneCount) {
        throw validationError(
          `Only ${boundaries.length} usable beat(s) were found but the project has ${sceneCount} ` +
            'scenes, so there are not enough boundaries to cut on. Try mode "every-beat", ' +
            'lower minStrength, or delete some scenes.',
          { boundaries: boundaries.length, sceneCount, mode: args.mode },
        );
      }

      /* Walk the scenes, giving each the span from the previous boundary to the
         next one. Cumulative rather than per-scene so rounding cannot drift the
         later cuts away from the music. */
      const MIN = engine.MIN_SCENE_DURATION;
      const MAX = engine.MAX_SCENE_DURATION;
      const clamped = [];
      let cursor = 0;
      const durations = stored.project.scenes.map((scene, index) => {
        const boundary = boundaries[index];
        const wanted = boundary.time - cursor;
        const duration = Math.min(MAX, Math.max(MIN, wanted));
        if (Math.abs(duration - wanted) > 1e-6) {
          clamped.push({ sceneId: scene.id, wanted: round(wanted), applied: round(duration) });
        }
        cursor += duration;
        return duration;
      });

      const plan = stored.project.scenes.map((scene, index) => ({
        sceneId: scene.id,
        index,
        duration: round(durations[index]),
        landsOn: round(boundaries[index].time),
        beatStrength: boundaries[index].strength,
      }));

      if (args.preview) {
        return ok({
          preview: true,
          bpm: analysis.bpm,
          confidence: analysis.confidence,
          quality: analysis.quality,
          plan,
          ...(clamped.length ? { clamped } : {}),
        });
      }

      const after = await mutateProject(args.projectId, (project) => ({
        ...project,
        scenes: project.scenes.map((scene, index) => ({ ...scene, duration: durations[index] })),
      }));

      const canvas = engine.canvasFor(after.project.format);
      return ok({
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        quality: analysis.quality,
        mode: args.mode,
        plan,
        totalDuration: round(engine.totalSeconds(after.project.scenes, canvas.fps)),
        ...(clamped.length
          ? { clamped, note: `${clamped.length} scene(s) hit the ${MIN}–${MAX}s limits and could not land exactly on their beat.` }
          : {}),
      });
    }),
  );
};
