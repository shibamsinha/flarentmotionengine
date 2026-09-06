/**
 * Timing tools.
 *
 * Flarent has no timeline object. Scenes are laid end to end and every start
 * time is *derived* from the durations before it, by `buildTimeline`, whenever
 * anyone asks. That single fact shapes this whole file:
 *
 *  - There is no "move scene 3 to 4.2s". Changing when a scene starts means
 *    changing what runs before it, so the honest operations are on durations
 *    and on order.
 *  - Nothing here caches or stores a start time. Doing so would create a second
 *    account of the timeline that could disagree with the renderer's.
 *
 * The transformations are deterministic and happen server-side on purpose: a
 * model asked to make a video 15% faster should not be multiplying durations
 * itself and rounding differently each time. It states the intent; the engine's
 * own limits and frame grid do the rest.
 */

import { z } from 'zod';

import { guard, notFound, ok, validationError } from '../lib/errors.mjs';
import { once } from '../lib/idempotency.mjs';
import { definedOnly, replaceElement, replaceScene, requireElement, requireScene } from '../lib/scenes.mjs';
import { mutateProject, readProject } from '../lib/store.mjs';
import { projectSummary, round, sceneDetail } from '../lib/summary.mjs';

export const registerTimingTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;
  const MIN = engine.MIN_SCENE_DURATION;
  const MAX = engine.MAX_SCENE_DURATION;

  /**
   * Clamp, and say so.
   *
   * A scaling operation can easily push a short scene under the engine's floor.
   * Silently clamping would make "twice as fast" quietly not be, so every
   * clamped scene is reported back in the result.
   */
  const clampDuration = (seconds) => Math.min(MAX, Math.max(MIN, seconds));

  server.registerTool(
    'set_scene_duration',
    {
      title: 'Set scene duration',
      description:
        `Set one scene's length, in seconds (${MIN}–${MAX}) or in frames. Every later scene shifts to ` +
        'follow, because scenes play end to end. The value is snapped to the 30fps frame ' +
        'grid on save, so it can come back a few milliseconds different.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        duration: s.duration.optional().describe('Seconds.'),
        durationInFrames: s.durationInFrames.optional(),
      },
    },
    guard(async (args) => {
      if (args.duration === undefined && args.durationInFrames === undefined) {
        throw validationError('Pass `duration` (seconds) or `durationInFrames`.');
      }
      // Frames win: an editor asking for 7 means exactly 7.
      const seconds = args.durationInFrames !== undefined
        ? engine.framesToSeconds(args.durationInFrames, engine.canvasFor('portrait').fps)
        : args.duration;

      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        return replaceScene(project, index, { ...scene, duration: seconds });
      });
      return ok({ project: projectSummary(stored, engine) });
    }),
  );

  server.registerTool(
    'set_element_timing',
    {
      title: 'Set element timing',
      description:
        'Set when something inside a scene starts. For a text element pass `delay` (seconds ' +
        'after the scene begins). For a graphic object pass `start` and optionally `duration`. ' +
        'Timing inside a scene is always relative to that scene, never to the whole video.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        elementId: s.elementId.describe('A text element id or an object id.'),
        delay: z.number().min(0).max(60).optional().describe('Text elements: seconds before it enters.'),
        start: z.number().min(0).max(60).optional().describe('Objects: seconds from the scene start.'),
        duration: z.number().min(0.05).max(60).optional().describe('Objects: how long it stays.'),
      },
    },
    guard(async (args) => {
      if (args.delay === undefined && args.start === undefined && args.duration === undefined) {
        throw validationError('Pass `delay` (text) or `start`/`duration` (objects).');
      }

      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);

        const textIndex = (scene.elements ?? []).findIndex((el) => el.id === args.elementId);
        if (textIndex !== -1) {
          if (args.delay === undefined) {
            throw validationError(
              'That id is a text element — pass `delay`. Text elements have no independent ' +
                'duration; they are paced across the scene by the planner.',
              { elementId: args.elementId },
            );
          }
          return replaceScene(
            project, index,
            replaceElement(scene, textIndex, { ...scene.elements[textIndex], delay: args.delay }),
          );
        }

        const object = engine.findObject(scene.objects ?? [], args.elementId);
        if (!object) {
          throw notFound(`Nothing with id ${args.elementId} is in scene ${args.sceneId}.`, {
            availableElementIds: (scene.elements ?? []).map((el) => el.id),
            availableObjectIds: engine.flattenObjects(scene.objects ?? []).map((r) => r.object.id),
          });
        }
        const patch = definedOnly({ start: args.start, duration: args.duration });
        if (Object.keys(patch).length === 0) {
          throw validationError('That id is an object — pass `start` and/or `duration`.');
        }
        return replaceScene(project, index, {
          ...scene,
          objects: engine.updateObject(scene.objects ?? [], args.elementId, patch),
        });
      });

      const { index } = requireScene(stored.project, args.sceneId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
      return ok({ scene: sceneDetail(stored.project.scenes[index], timeline[index]) });
    }),
  );

  server.registerTool(
    'scale_timing',
    {
      title: 'Scale timing',
      description:
        'Stretch or compress durations across the whole video or a run of scenes. Give ' +
        'either `factor` (multiplies each duration — 0.5 is twice as fast) or ' +
        '`targetDuration` (fit the whole video to a length, which is how to answer "make it ' +
        '7 seconds"). Set `progressive` to ramp the factor across the selected scenes rather ' +
        'than applying it evenly — that is what "make the first three progressively faster" ' +
        'means. Durations are clamped to the engine\'s limits and any clamping is reported.',
      inputSchema: {
        projectId: s.projectId,
        factor: z
          .number()
          .min(0.05)
          .max(20)
          .optional()
          .describe('Multiplier on each duration. 0.5 halves them; 2 doubles them.'),
        targetDuration: z
          .number()
          .min(0.2)
          .max(600)
          .optional()
          .describe('Total seconds the whole video should last. Mutually exclusive with factor.'),
        sceneIds: z
          .array(s.sceneId)
          .optional()
          .describe('Limit the change to these scenes. Defaults to all of them.'),
        progressive: z
          .boolean()
          .optional()
          .describe('Ramp from no change up to `factor` across the selected scenes.'),
      },
    },
    guard(async (args) => {
      if ((args.factor === undefined) === (args.targetDuration === undefined)) {
        throw validationError('Pass exactly one of `factor` or `targetDuration`.');
      }
      if (args.targetDuration !== undefined && args.progressive) {
        throw validationError('`progressive` only applies with `factor`.');
      }

      const clamped = [];
      const stored = await mutateProject(args.projectId, (project) => {
        const selected = args.sceneIds ?? project.scenes.map((scene) => scene.id);
        for (const id of selected) requireScene(project, id);

        let factorFor;
        if (args.targetDuration !== undefined) {
          /* Fit to a length. The ratio is computed against the *selected*
             scenes' share, so fitting a subset still lands the whole video on
             the requested total. */
          const total = project.scenes.reduce((sum, scene) => sum + scene.duration, 0);
          const selectedTotal = project.scenes
            .filter((scene) => selected.includes(scene.id))
            .reduce((sum, scene) => sum + scene.duration, 0);
          const fixed = total - selectedTotal;
          const room = args.targetDuration - fixed;
          if (room <= 0) {
            throw validationError(
              `The scenes not being scaled already run ${round(fixed)}s, so the video cannot ` +
                `total ${args.targetDuration}s. Widen the selection or pick a longer target.`,
              { fixedSeconds: round(fixed), targetDuration: args.targetDuration },
            );
          }
          const ratio = room / selectedTotal;
          factorFor = () => ratio;
        } else if (args.progressive) {
          /* Linear ramp from 1 (unchanged) to `factor` across the selection, so
             the first selected scene keeps its length and the last takes the
             full change. With one scene there is no ramp to speak of, so it
             takes the factor outright. */
          const count = selected.length;
          factorFor = (position) =>
            count <= 1 ? args.factor : 1 + ((args.factor - 1) * position) / (count - 1);
        } else {
          factorFor = () => args.factor;
        }

        let position = 0;
        const scenes = project.scenes.map((scene) => {
          if (!selected.includes(scene.id)) return scene;
          const wanted = scene.duration * factorFor(position);
          position += 1;
          const duration = clampDuration(wanted);
          if (Math.abs(duration - wanted) > 1e-6) {
            clamped.push({ sceneId: scene.id, wanted: round(wanted), applied: round(duration) });
          }
          return { ...scene, duration };
        });

        return { ...project, scenes };
      });

      return ok({
        project: projectSummary(stored, engine),
        ...(clamped.length
          ? { clamped, note: `${clamped.length} scene(s) hit the ${MIN}–${MAX}s limits.` }
          : {}),
      });
    }),
  );

  server.registerTool(
    'shift_timing',
    {
      title: 'Shift timing',
      description:
        'Move everything inside a scene earlier or later by a number of seconds — text ' +
        'element delays and object start times together. Use this to hold a scene\'s content ' +
        'back so it lands on a beat. It does not change the scene\'s own length or position; ' +
        'for that use set_scene_duration or reorder_scenes.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        seconds: z
          .number()
          .min(-30)
          .max(30)
          .describe('Positive delays the content; negative pulls it earlier. Clamped at zero.'),
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        const shift = (value) => Math.max(0, round((value ?? 0) + args.seconds));

        const shiftObject = (object) => ({
          ...object,
          start: shift(object.start),
          ...(object.children ? { children: object.children.map(shiftObject) } : {}),
        });

        return replaceScene(project, index, {
          ...scene,
          ...(scene.elements
            ? { elements: scene.elements.map((el) => ({ ...el, delay: shift(el.delay) })) }
            : {}),
          ...(scene.objects ? { objects: scene.objects.map(shiftObject) } : {}),
        });
      });

      const { index } = requireScene(stored.project, args.sceneId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
      return ok({ scene: sceneDetail(stored.project.scenes[index], timeline[index]) });
    }),
  );


  server.registerTool(
    'set_timeline_durations',
    {
      title: 'Set timeline durations',
      description:
        'Set every scene length at once from a cut list, in scene order. This is the tool ' +
        'for "the cuts are 7, 8, 6, 5, 9" — one call and one write, rather than N.\n' +
        'Give `framesPerScene` (exact, preferred for cutting) or `secondsPerScene`. By ' +
        'default the array must name every scene; pass `fromIndex` to apply a shorter list ' +
        'to a run of scenes starting there. Returns the resulting timeline.',
      inputSchema: {
        projectId: s.projectId,
        framesPerScene: z
          .array(z.number().int().min(1).max(Math.round(MAX * 30)))
          .min(1)
          .max(400)
          .optional()
          .describe('Frame count per scene, in order.'),
        secondsPerScene: z
          .array(z.number().min(MIN).max(MAX))
          .min(1)
          .max(400)
          .optional()
          .describe('Seconds per scene, in order.'),
        fromIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Apply the list starting at this scene. Defaults to 0 and requires a full list.'),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('set_timeline_durations', args.idempotencyKey, async () => {
        if ((args.framesPerScene === undefined) === (args.secondsPerScene === undefined)) {
          throw validationError('Pass exactly one of `framesPerScene` or `secondsPerScene`.');
        }

        const fps = engine.canvasFor('portrait').fps;
        const seconds = args.framesPerScene
          ? args.framesPerScene.map((frames) => engine.framesToSeconds(frames, fps))
          : args.secondsPerScene;

        const stored = await mutateProject(args.projectId, (project) => {
          const start = args.fromIndex ?? 0;
          if (start >= project.scenes.length) {
            throw validationError(
              `fromIndex ${start} is past the end — this project has ${project.scenes.length} scenes.`,
              { sceneCount: project.scenes.length },
            );
          }
          /*
           * Length is checked, not truncated.
           *
           * A cut list that does not match the timeline is almost always a
           * mistake — a scene added or removed since the list was written — and
           * silently applying the first N would leave the rest at their old
           * lengths, which is the hardest kind of wrong to notice. `fromIndex`
           * is the explicit way to mean "just this run".
           */
          const available = project.scenes.length - start;
          if (seconds.length !== available) {
            throw validationError(
              `Expected ${available} duration(s) from index ${start}, got ${seconds.length}. ` +
                'Pass one per scene, or use `fromIndex` to target a shorter run.',
              { sceneCount: project.scenes.length, fromIndex: start, received: seconds.length },
            );
          }

          return {
            ...project,
            scenes: project.scenes.map((scene, i) =>
              i >= start ? { ...scene, duration: seconds[i - start] } : scene,
            ),
          };
        });

        const canvas = engine.canvasFor(stored.project.format);
        const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
        return ok({
          duration: round(engine.totalSeconds(stored.project.scenes, canvas.fps)),
          frames: engine.totalFrames(stored.project.scenes, canvas.fps),
          scenes: timeline.map((entry) => ({
            sceneId: entry.scene.id,
            index: entry.index,
            start: round(entry.fromSeconds),
            duration: round(entry.durationInSeconds),
            frames: entry.durationInFrames,
          })),
        });
      }),
    ),
  );

  server.registerTool(
    'inspect_timeline',
    {
      title: 'Inspect timeline',
      description:
        'The whole video laid out in time: every scene with its start, duration and frame ' +
        'range, plus the totals. This is the view to read before re-timing anything.',
      inputSchema: { projectId: s.projectId },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);

      return ok({
        projectId: stored.id,
        fps: canvas.fps,
        duration: round(engine.totalSeconds(stored.project.scenes, canvas.fps)),
        frames: engine.totalFrames(stored.project.scenes, canvas.fps),
        limits: { minSceneDuration: MIN, maxSceneDuration: MAX },
        scenes: timeline.map((entry) => ({
          sceneId: entry.scene.id,
          index: entry.index,
          start: round(entry.fromSeconds),
          end: round(entry.fromSeconds + entry.durationInSeconds),
          duration: round(entry.durationInSeconds),
          frames: entry.durationInFrames,
        })),
      });
    }),
  );
};
