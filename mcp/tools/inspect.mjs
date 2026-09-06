/**
 * Inspection tools.
 *
 * A model has to be able to see what it has built without re-reading the whole
 * document every time. These are the read side of the interface, and each one is
 * scoped so a caller can ask a narrow question and get a narrow answer:
 *
 *   inspect_project    the shape of the whole thing, scenes one line each
 *   inspect_scene      one scene in full, elements and objects
 *   inspect_timeline   (in tools/timing.mjs — it belongs with re-timing)
 *   inspect_audio      the track, and its analysis if it has been run
 *   inspect_animation  what moves, and how, across the project
 *
 * None of them returns raw Flarent JSON. That is not a stylistic preference:
 * a four-scene reel with objects serialises to several hundred lines, and
 * returning that on every call would spend most of a model's context on fields
 * it cannot act on. `get_flarent_json` exists for the rare case where the raw
 * document really is wanted — and says in its description that it is expensive.
 */

import { z } from 'zod';

import { cachedAnalysis } from '../lib/audio-analysis.mjs';
import { resolveAssetPath } from '../lib/assets.mjs';
import { guard, ok } from '../lib/errors.mjs';
import { requireScene } from '../lib/scenes.mjs';
import { readProject } from '../lib/store.mjs';
import { audioSummary, projectSummary, round, sceneDetail } from '../lib/summary.mjs';

export const registerInspectTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  server.registerTool(
    'inspect_project',
    {
      title: 'Inspect project',
      description:
        'The whole project at a glance: format, total duration, audio state, and one compact ' +
        'row per scene with its id, start, duration and how much it contains. Start here ' +
        'before changing anything you did not just create.',
      inputSchema: { projectId: s.projectId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) =>
      ok({ project: projectSummary(await readProject(args.projectId), engine) }),
    ),
  );

  server.registerTool(
    'inspect_scene',
    {
      title: 'Inspect scene',
      description:
        'One scene in full: its copy, style, composition and every text element and graphic ' +
        'object with ids and motion. This is the detailed view — use it when you need element ' +
        'ids to modify something.',
      inputSchema: { projectId: s.projectId, sceneId: s.sceneId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const { index } = requireScene(stored.project, args.sceneId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
      return ok({ scene: sceneDetail(stored.project.scenes[index], timeline[index]) });
    }),
  );

  server.registerTool(
    'inspect_audio',
    {
      title: 'Inspect audio',
      description:
        'The project\'s audio track and, when it has already been analysed, its estimated ' +
        'tempo and beat count. This does not run analysis itself — call analyze_audio for ' +
        'that — so it is always cheap.',
      inputSchema: { projectId: s.projectId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      if (!stored.project.audio) return ok({ audio: { present: false } });

      /* Cached results only. Running a decode inside an "inspect" tool would
         make a read unexpectedly expensive, and a model calling inspect_* to
         orient itself should never pay seconds for it. */
      let analysis = null;
      try {
        analysis = await cachedAnalysis(resolveAssetPath(stored.project.audio.src));
      } catch {
        analysis = null; // Missing file — reported by the summary's own fields.
      }

      return ok({
        audio: audioSummary(stored.project.audio, analysis),
        ...(analysis
          ? {
              analysis: {
                bpm: analysis.bpm,
                confidence: analysis.confidence,
                quality: analysis.quality,
                beatCount: analysis.beats.length,
                ...(analysis.note ? { note: analysis.note } : {}),
              },
            }
          : { analysisNote: 'Not analysed yet — call analyze_audio.' }),
      });
    }),
  );

  server.registerTool(
    'inspect_animation',
    {
      title: 'Inspect animation',
      description:
        'What moves across the project and how: each scene\'s animation style, each text ' +
        'element\'s override and delay, and each object\'s entrance, emphasis, exit, speed and ' +
        'distance. Read this before restyling motion so you can see what is already set.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId.optional().describe('Limit to one scene.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);

      const wanted = args.sceneId
        ? [timeline[requireScene(stored.project, args.sceneId).index]]
        : timeline;

      const objectMotion = (object, depth = 0) => [
        {
          objectId: object.id,
          type: object.type,
          depth,
          ...(object.motion?.enter ? { entrance: object.motion.enter } : {}),
          ...(object.motion?.emphasis ? { emphasis: object.motion.emphasis } : {}),
          ...(object.motion?.exit ? { exit: object.motion.exit } : {}),
          ...(object.motion?.speed ? { speed: object.motion.speed } : {}),
          ...(object.motion?.distance ? { distance: object.motion.distance } : {}),
          ...(object.motion?.from ? { from: object.motion.from } : {}),
          ...(object.motion?.delay ? { delay: round(object.motion.delay) } : {}),
          ...(object.start ? { start: round(object.start) } : {}),
        },
        ...(object.children ?? []).flatMap((child) => objectMotion(child, depth + 1)),
      ];

      return ok({
        projectId: stored.id,
        model: 'intent',
        note:
          'Flarent has no keyframes. Text uses five kinetic styles; objects use an ' +
          'entrance/emphasis/exit vocabulary. The planners resolve these to curves at render time.',
        scenes: wanted.map((entry) => ({
          sceneId: entry.scene.id,
          index: entry.index,
          duration: round(entry.durationInSeconds),
          sceneStyle: entry.scene.style,
          ...(entry.scene.direction ? { direction: entry.scene.direction } : {}),
          ...(entry.scene.composition ? { composition: entry.scene.composition } : {}),
          elements: (entry.scene.elements ?? []).map((element) => ({
            elementId: element.id,
            text: element.text.replace(/\s+/g, ' ').slice(0, 40),
            animation: element.animation ?? `${entry.scene.style} (from the scene)`,
            ...(element.role ? { role: element.role } : {}),
            ...(element.delay !== undefined ? { delay: round(element.delay) } : {}),
          })),
          objects: (entry.scene.objects ?? []).flatMap((object) => objectMotion(object)),
        })),
      });
    }),
  );

  server.registerTool(
    'get_flarent_json',
    {
      title: 'Get Flarent JSON',
      description:
        'The raw Flarent project document — the exact format the editor imports and the ' +
        'engine renders. EXPENSIVE: this is the full document and can run to hundreds of ' +
        'lines. Prefer inspect_project or inspect_scene; use this only when you genuinely ' +
        'need the document itself, for instance to hand a user something to import.',
      inputSchema: { projectId: s.projectId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const json = engine.serialiseProject(
        stored.project.scenes,
        stored.project.title,
        stored.project.fields,
        stored.project.overlay,
        stored.project.format,
        stored.project.audio,
        stored.project.ink,
        stored.project.accent,
      );
      return ok({
        projectId: stored.id,
        bytes: Buffer.byteLength(json),
        note: 'Paste this into the editor\'s Import JSON door to open the project there.',
        document: JSON.parse(json),
      });
    }),
  );

  server.registerTool(
    'describe_capabilities',
    {
      title: 'Describe capabilities',
      description:
        'What this Flarent engine can and cannot do. Call this when you are unsure whether a ' +
        'motion-design idea is expressible — it is faster than discovering a limit by ' +
        'trial and error, and it lists what to use instead.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () =>
      ok({
        supported: {
          typography: 'Semantic only: roles, size presets, positions, compositions, alignment, case, per-word colour.',
          motion: 'Intent-based. Six text animation styles including NONE (a genuine hold); objects get entrance/emphasis/exit with speed, distance and direction.',
          textExits: 'Text leaves in the manner of an animation style, set separately from how it arrived. NONE removes the exit and makes a hard cut.',
          wordStagger: 'Words can enter a fixed number of frames apart, forward or reverse.',
          backgroundMotion: 'A scene can alternate its field every N frames while the type holds still, optionally for a limited number of flips.',
          objects: 'Shapes, cards, buttons, icons (18 built in), logos, a cursor with click actions, and groups.',
          audio: 'One project-level track with independent source trim and timeline offset, volume, fades and loop.',
          analysis: 'Estimated tempo and beat positions, computed by onset detection. Confidence is reported; treat it as an estimate.',
          rendering: 'H.264 MP4 via the render server, plus single-frame PNG previews.',
          formats: 'Portrait 1080x1920 and landscape 1920x1080, both at 30fps.',
        },
        notSupported: {
          keyframes: 'There is no keyframe model. Use apply_motion_style, set_entrance, set_emphasis and set_exit.',
          video: 'Scenes cannot contain video clips. Only images, type and graphic objects.',
          fontControl: 'One typeface, weights fixed per role, no letter-spacing or line-height controls. Use apply_typography_style.',
          sceneLevelAudio: 'Audio is project-level by design so scenes can be re-timed under it.',
          transitions: 'There is no transition object. What plays between scenes is the outgoing scene\'s `exit` and the incoming one\'s `style`.',
          authentication: 'This server has no accounts or ownership. It runs locally as your OS user.',
        },
        limits: {
          minSceneDuration: 0.15,
          maxSceneDuration: 12,
          fps: 30,
        },
      }),
    ),
  );
};
