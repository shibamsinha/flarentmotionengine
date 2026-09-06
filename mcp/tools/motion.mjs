/**
 * Motion tools.
 *
 * **Flarent has no keyframes.** Motion is stored as *intent* — an entrance, an
 * emphasis, an exit, plus a speed and a distance — and the planners resolve that
 * intent into curves over opacity, x, y, scale, rotation and blur at render
 * time. `FLOAT_IN` is not "translate up 40px"; it is a flat opacity curve, a
 * rise on a settling bezier, a slight scale and a blur that burns off early.
 *
 * So these tools write intent into the document and nothing else. No curve is
 * evaluated here, no easing is chosen here, no timing is computed here. The
 * planners stay the single source of truth, which is what keeps a reel authored
 * over MCP identical to the same reel authored in the editor.
 *
 * Two motion models sit side by side, matching the engine:
 *
 *   text     `scene.style` and `element.animation` — the five kinetic styles
 *   objects  `object.motion` — entrance / emphasis / exit with speed and distance
 *
 * `animate_element` spans both so a model holding an id need not know which.
 */

import { z } from 'zod';

import { guard, notFound, ok, validationError } from '../lib/errors.mjs';
import { definedOnly, replaceElement, replaceScene, requireScene } from '../lib/scenes.mjs';
import { mutateProject } from '../lib/store.mjs';
import { sceneDetail } from '../lib/summary.mjs';

/**
 * Named motion intents.
 *
 * Each row names both halves — what the scene's type does and what its objects
 * do — because "make this scene aggressive" should not produce punchy type over
 * a gently floating card. A fixed table, so the same words always produce the
 * same document.
 */
const MOTION_STYLES = {
  aggressive: {
    describe: 'Hits hard and fast. Type punches in; objects pop with a shake.',
    text: { style: 'punch' },
    object: { enter: 'pop-in', speed: 'fast', distance: 'large', emphasis: 'shake' },
  },
  punchy: {
    describe: 'Quick and confident, without the shake.',
    text: { style: 'punch' },
    object: { enter: 'pop-in', speed: 'fast', distance: 'medium' },
  },
  cinematic: {
    describe: 'Slow, smooth and weighted. The closest thing to a soft transition.',
    text: { style: 'slide' },
    object: { enter: 'float-in', speed: 'slow', distance: 'medium' },
  },
  calm: {
    describe: 'Understated. Fades and small rises, nothing that draws attention.',
    text: { style: 'slide' },
    object: { enter: 'fade-in', speed: 'medium', distance: 'small' },
  },
  massive: {
    describe: 'Display type at full scale. For the one line that carries the film.',
    text: { style: 'massive' },
    object: { enter: 'scale-in', speed: 'medium', distance: 'medium' },
  },
  rapid: {
    describe: 'Machine-gun cuts through a list. Type flips scene by scene.',
    text: { style: 'rapid' },
    object: { enter: 'pop-in', speed: 'fast', distance: 'small' },
  },
  stack: {
    describe: 'Lines assemble one over another.',
    text: { style: 'stack' },
    object: { enter: 'rise-in', speed: 'medium', distance: 'small' },
  },
};

export const registerMotionTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  const sceneResult = (stored, sceneId) => {
    const { index } = requireScene(stored.project, sceneId);
    const canvas = engine.canvasFor(stored.project.format);
    const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
    return sceneDetail(stored.project.scenes[index], timeline[index]);
  };

  /**
   * Merge a patch into an object's `motion`, at any depth.
   *
   * Merging rather than replacing: setting a speed should not silently discard
   * the entrance that was already chosen.
   */
  const patchObjectMotion = async (args, motionPatch) =>
    mutateProject(args.projectId, (project) => {
      const { scene, index } = requireScene(project, args.sceneId);
      const existing = engine.findObject(scene.objects ?? [], args.objectId);
      if (!existing) {
        throw notFound(`Object ${args.objectId} is not in scene ${args.sceneId}.`, {
          objectId: args.objectId,
          availableObjectIds: engine.flattenObjects(scene.objects ?? []).map((r) => r.object.id),
        });
      }
      const motion = { ...(existing.motion ?? {}), ...definedOnly(motionPatch) };
      return replaceScene(project, index, {
        ...scene,
        objects: engine.updateObject(scene.objects ?? [], args.objectId, { motion }),
      });
    });

  const objectMotionTool = (name, title, description, field, schema, extra = {}) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          projectId: s.projectId,
          sceneId: s.sceneId,
          objectId: s.elementId.describe('A graphic object id, from inspect_scene.'),
          [field]: schema,
          ...extra,
        },
      },
      guard(async (args) => {
        const stored = await patchObjectMotion(args, {
          [field]: args[field],
          ...(args.direction !== undefined ? { from: args.direction } : {}),
        });
        return ok({ scene: sceneResult(stored, args.sceneId) });
      }),
    );
  };

  /* ------------------------------------------------------- the high-level */

  server.registerTool(
    'apply_motion_style',
    {
      title: 'Apply motion style',
      description:
        'Set how a whole scene moves from one named intent — the preferred motion tool. ' +
        'Each style sets both the type\'s animation and every object\'s entrance together, so ' +
        'they agree. Flarent has no separate transition object: what plays between two ' +
        'scenes is this style, so "give it a smooth cinematic transition" means cinematic here.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        style: z
          .enum(Object.keys(MOTION_STYLES))
          .describe(
            Object.entries(MOTION_STYLES)
              .map(([name, spec]) => `${name}: ${spec.describe}`)
              .join(' | '),
          ),
        objectsToo: z
          .boolean()
          .optional()
          .describe('Also restyle the scene\'s graphic objects. Default true.'),
      },
    },
    guard(async (args) => {
      const spec = MOTION_STYLES[args.style];
      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);

        let next = { ...scene, ...spec.text };

        /* Elements carrying their own `animation` would override the scene's,
           so a scene-level restyle has to clear them or it appears to do
           nothing on exactly the scenes that were most carefully authored. */
        if (next.elements?.length) {
          next.elements = next.elements.map(({ animation, ...rest }) => rest);
        }

        if (args.objectsToo !== false && next.objects?.length) {
          const applyMotion = (object) => ({
            ...object,
            // A cursor's movement is its stop list, not an entrance; restyling
            // it would fight the path the author laid out.
            ...(object.type === 'cursor'
              ? {}
              : { motion: { ...(object.motion ?? {}), ...spec.object } }),
            ...(object.children ? { children: object.children.map(applyMotion) } : {}),
          });
          next.objects = next.objects.map(applyMotion);
        }

        return replaceScene(project, index, next);
      });

      return ok({ applied: args.style, scene: sceneResult(stored, args.sceneId) });
    }),
  );

  server.registerTool(
    'animate_element',
    {
      title: 'Animate element',
      description:
        'Set the motion of one thing by id — it finds whether the id is a text element or a ' +
        'graphic object and applies the right model. For text pass `animation`; for objects ' +
        'pass any of entrance / emphasis / exit / speed / distance / direction.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        elementId: s.elementId.describe('A text element id or an object id.'),
        animation: s.animationStyle.optional().describe('Text only: which kinetic style.'),
        entrance: s.enterMotion.optional().describe('Objects only.'),
        emphasis: s.emphasisMotion.optional().describe('Objects only: what it does once it has arrived.'),
        exit: s.exitMotion.optional().describe('Objects only.'),
        speed: s.motionSpeed.optional().describe('Objects only.'),
        distance: s.motionDistance.optional().describe('Objects only: how far it travels.'),
        direction: s.direction.optional().describe('Objects only: which edge a slide comes from.'),
        delay: z.number().min(0).max(10).optional().describe('Seconds to hold before it starts.'),
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);

        const asText = (scene.elements ?? []).findIndex((el) => el.id === args.elementId);
        if (asText !== -1) {
          if (args.entrance || args.emphasis || args.exit || args.speed || args.distance) {
            throw validationError(
              'That id is a text element, which uses Flarent\'s five kinetic styles rather than ' +
                'the object entrance/emphasis/exit model. Pass `animation` (and optionally `delay`).',
              { elementId: args.elementId, use: ['animation', 'delay'] },
            );
          }
          const patch = definedOnly({ animation: args.animation, delay: args.delay });
          if (Object.keys(patch).length === 0) {
            throw validationError('Pass `animation` or `delay` for a text element.');
          }
          return replaceScene(
            project, index,
            replaceElement(scene, asText, { ...scene.elements[asText], ...patch }),
          );
        }

        const object = engine.findObject(scene.objects ?? [], args.elementId);
        if (!object) {
          throw notFound(`Nothing with id ${args.elementId} is in scene ${args.sceneId}.`, {
            availableElementIds: (scene.elements ?? []).map((el) => el.id),
            availableObjectIds: engine.flattenObjects(scene.objects ?? []).map((r) => r.object.id),
          });
        }
        if (args.animation) {
          throw validationError(
            'That id is a graphic object, which does not use the text animation styles. ' +
              'Pass `entrance`, `emphasis`, `exit`, `speed`, `distance` or `direction`.',
            { objectId: args.elementId },
          );
        }

        const motionPatch = definedOnly({
          enter: args.entrance,
          emphasis: args.emphasis,
          exit: args.exit,
          speed: args.speed,
          distance: args.distance,
          from: args.direction,
          delay: args.delay,
        });
        if (Object.keys(motionPatch).length === 0) {
          throw validationError('Pass at least one motion field for an object.');
        }

        return replaceScene(project, index, {
          ...scene,
          objects: engine.updateObject(scene.objects ?? [], args.elementId, {
            motion: { ...(object.motion ?? {}), ...motionPatch },
          }),
        });
      });

      return ok({ scene: sceneResult(stored, args.sceneId) });
    }),
  );

  /* -------------------------------------------------------- the low-level */

  objectMotionTool(
    'set_entrance', 'Set entrance',
    'How a graphic object arrives. Each name is a recipe over several channels at once, ' +
      'not a single translation — the engine owns the curves.',
    'enter', s.enterMotion,
    { direction: s.direction.optional().describe('Which edge, for the slide family.') },
  );

  objectMotionTool(
    'set_emphasis', 'Set emphasis',
    'What a graphic object does after it has arrived — a pulse, a glow, a shake. Held for ' +
      'the object\'s lifetime rather than played once.',
    'emphasis', s.emphasisMotion,
  );

  objectMotionTool(
    'set_exit', 'Set exit',
    'How a graphic object leaves, before the end of its window.',
    'exit', s.exitMotion,
  );

  objectMotionTool(
    'set_motion_speed', 'Set motion speed',
    'How long an object\'s entrance takes, as a feel rather than a number of seconds.',
    'speed', s.motionSpeed,
  );

  objectMotionTool(
    'set_motion_distance', 'Set motion distance',
    'How far an object travels on its way in.',
    'distance', s.motionDistance,
  );

  objectMotionTool(
    'set_motion_direction', 'Set motion direction',
    'Which edge a sliding object comes from. Only meaningful for the slide family.',
    'from', s.direction,
  );

  server.registerTool(
    'list_motion_vocabulary',
    {
      title: 'List motion vocabulary',
      description:
        'Every animation style, entrance, emphasis and exit the engine actually supports, ' +
        'plus the named motion styles. Call this rather than guessing a motion name.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () =>
      ok({
        // From the engine rather than a hand-kept copy: the literal list here
        // silently went stale when NONE was added, so the one tool whose job is
        // "do not guess a motion name" was the last place NONE could be found.
        textAnimationStyles: engine.ANIMATION_STYLES,
        objectEntrances: engine.ENTER_NAMES,
        objectEmphases: engine.EMPHASIS_NAMES,
        objectExits: engine.EXIT_NAMES,
        speeds: ['slow', 'medium', 'fast'],
        distances: ['small', 'medium', 'large'],
        motionStyles: Object.fromEntries(
          Object.entries(MOTION_STYLES).map(([name, spec]) => [name, spec.describe]),
        ),
        note: 'Flarent has no keyframes. Motion is intent; the planners resolve it to curves.',
      }),
    ),
  );
};
