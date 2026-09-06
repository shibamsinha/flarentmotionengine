/**
 * Content tools — the things inside a scene.
 *
 * A scene holds two separate lists, and keeping them separate is an
 * architectural decision the engine makes deliberately:
 *
 *   `elements`  text, with the specialised model type has earned — semantic
 *               roles, size presets, compositions, per-word colour
 *   `objects`   graphics, as a tree — shapes, cards, buttons, icons, a cursor
 *
 * They are not merged, so neither carries the other's concepts. The tools mirror
 * that: `add_text` writes to one list, `add_shape` to the other. Only
 * `remove_element` spans both, because a model holding an id should not have to
 * know which list it came from to delete it.
 *
 * Text elements also keep `scene.text` in step (see `syncSceneText`) because the
 * importer requires a scene to have renderable content and several older
 * surfaces still read the plain string.
 */

import { z } from 'zod';

import { confirmationRequired, guard, notFound, ok, validationError } from '../lib/errors.mjs';
import { once } from '../lib/idempotency.mjs';
import { elementDetail, objectDetail, sceneDetail } from '../lib/summary.mjs';
import { definedOnly, replaceElement, replaceScene, requireElement, requireScene, syncSceneText } from '../lib/scenes.mjs';
import { mutateProject, readProject } from '../lib/store.mjs';

/** Re-read a scene and render it in full — what every mutation here returns. */
const sceneResult = (stored, sceneId, engine) => {
  const { index } = requireScene(stored.project, sceneId);
  const canvas = engine.canvasFor(stored.project.format);
  const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
  return sceneDetail(stored.project.scenes[index], timeline[index]);
};

export const registerContentTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  /* ------------------------------------------------------------------ text */

  server.registerTool(
    'add_text',
    {
      title: 'Add text',
      description:
        'Add a text element to a scene. A scene with several elements composes them using ' +
        'its `composition` preset, so prefer adding elements over packing newlines into one. ' +
        'Role and size are semantic (primary, oversized) rather than pixel values — that is ' +
        'the only typography model Flarent has.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        text: z.string().min(1).describe('The words. Newlines are allowed within one element.'),
        role: s.role.optional().describe('What this line is for. Supplies a default size.'),
        size: s.size.optional().describe('Overrides the size the role implies.'),
        fitWidth: s.fitWidth.optional(),
        fontRole: s.fontRole.optional().describe('PRIMARY (house sans) or ACCENT (serif italic).'),
        enterFrames: s.enterFrames.optional(),
        position: s.position.optional().describe('Overrides the scene composition\'s placement.'),
        animation: s.animationStyle.optional().describe('Overrides the scene\'s animation for this line.'),
        align: s.alignment.optional(),
        case: s.textCase.optional(),
        emphasis: z.array(z.string()).optional().describe('Words within this element to accent.'),
        delay: z.number().min(0).max(10).optional().describe('Seconds to wait before this line enters.'),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('add_text', args.idempotencyKey, async () => {
        const stored = await mutateProject(args.projectId, (project) => {
          const { scene, index } = requireScene(project, args.sceneId);
          const created = engine.element(
            args.text,
            definedOnly({
              role: args.role,
              size: args.size,
              fit: args.fitWidth === undefined ? undefined : { mode: 'width', maxWidth: args.fitWidth },
              fontRole: args.fontRole,
              enterFrames: args.enterFrames,
              position: args.position,
              animation: args.animation,
              align: args.align,
              case: args.case,
              emphasis: args.emphasis,
              delay: args.delay,
            }),
          );
          const next = syncSceneText({
            ...scene,
            elements: [...(scene.elements ?? []), created],
          });
          return replaceScene(project, index, next);
        });

        /*
         * Read the id back rather than reporting the one just minted.
         *
         * The Flarent document format does not store element ids —
         * `serialiseElement` omits them — so the importer assigns positional
         * ones (`<sceneIndex>-<elementIndex>`) on every load. The id that was
         * generated in memory a moment ago therefore does not exist any more,
         * and returning it would hand the caller an id that fails on its very
         * next call. The new element is the last one in the scene.
         */
        const scene = sceneResult(stored, args.sceneId, engine);
        const elementId = scene.elements[scene.elements.length - 1]?.elementId ?? null;

        return ok({ elementId, scene });
      }),
    ),
  );

  server.registerTool(
    'update_text',
    {
      title: 'Update text',
      description:
        'Change a text element\'s copy or its semantic typography. Only the fields you pass ' +
        'are touched. To change several properties as one intent, apply_typography_style is ' +
        'usually the better tool.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        elementId: s.elementId,
        text: z.string().min(1).optional(),
        role: s.role.optional(),
        size: s.size.optional(),
        fitWidth: s.fitWidth.optional(),
        fontRole: s.fontRole.optional().describe('PRIMARY (house sans) or ACCENT (serif italic).'),
        enterFrames: s.enterFrames.optional(),
        position: s.position.optional(),
        animation: s.animationStyle.optional(),
        align: s.alignment.optional(),
        case: s.textCase.optional(),
        emphasis: z.array(z.string()).optional(),
        delay: z.number().min(0).max(10).optional(),
      },
    },
    guard(async (args) => {
      const patch = definedOnly({
        text: args.text,
        role: args.role,
        size: args.size,
        fit: args.fitWidth === undefined ? undefined : { mode: 'width', maxWidth: args.fitWidth },
        fontRole: args.fontRole,
        enterFrames: args.enterFrames,
        position: args.position,
        animation: args.animation,
        align: args.align,
        case: args.case,
        emphasis: args.emphasis,
        delay: args.delay,
      });
      if (Object.keys(patch).length === 0) {
        throw validationError('Nothing to change — pass at least one field.');
      }

      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        const { element, index: elementIndex } = requireElement(scene, args.elementId);
        const next = syncSceneText(
          replaceElement(scene, elementIndex, { ...element, ...patch }),
        );
        return replaceScene(project, index, next);
      });

      return ok({ scene: sceneResult(stored, args.sceneId, engine) });
    }),
  );

  /* --------------------------------------------------------------- objects */

  server.registerTool(
    'add_shape',
    {
      title: 'Add shape',
      description:
        'Add a graphic object to a scene: a shape, card, button, icon, cursor or group. ' +
        'Geometry is in frame fractions with a top-left origin (0–1), so it composes the ' +
        'same way in portrait and landscape. Objects render above the type unless `layer` ' +
        'is negative. Every kind arrives already animated; use apply_motion_style to change it.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        kind: z
          .enum(['shape', 'card', 'button', 'icon', 'image', 'logo', 'cursor', 'group'])
          .describe('What kind of object.'),
        shape: s.shapeKind.optional().describe('Only for kind "shape".'),
        x: z.number().min(-1).max(2).optional().describe('Left edge, fraction of frame width.'),
        y: z.number().min(-1).max(2).optional().describe('Top edge, fraction of frame height.'),
        width: z.number().min(0.005).max(3).optional(),
        height: z.number().min(0.005).max(3).optional(),
        fill: s.hexColor.optional(),
        label: z.string().max(200).optional().describe('Button label or card title.'),
        body: z.string().max(400).optional().describe('Card supporting line.'),
        icon: z
          .enum([
            'check', 'plus', 'upload', 'download', 'folder', 'file', 'camera', 'scan',
            'search', 'arrow-right', 'chevron-right', 'close', 'heart', 'star', 'bell',
            'user', 'lock', 'play',
          ])
          .optional()
          .describe('Glyph, for kind "icon" or as a button icon. This is the whole built-in set.'),
        layer: z.number().int().min(-10).max(10).optional().describe('Negative puts the object behind the type.'),
        start: z.number().min(0).max(60).optional().describe('Seconds from the scene start.'),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('add_shape', args.idempotencyKey, async () => {
        if (args.kind === 'shape' && args.shape === undefined) {
          // Not fatal — the engine's own default is 'rounded' — but saying so
          // beats silently picking for the caller.
          args = { ...args, shape: 'rounded' };
        }

        let objectId = null;
        const stored = await mutateProject(args.projectId, (project) => {
          const { scene, index } = requireScene(project, args.sceneId);

          // The engine's constructor supplies a visible, already-animated
          // default for every kind; MCP only overrides what the caller asked for.
          const base = engine.newObject(args.kind);
          const object = {
            ...base,
            ...definedOnly({
              x: args.x, y: args.y, width: args.width, height: args.height,
              layer: args.layer, start: args.start,
              ...(args.kind === 'shape' && args.shape ? { shape: args.shape } : {}),
              ...(args.kind === 'icon' && args.icon ? { icon: args.icon } : {}),
            }),
          };

          if (args.fill) object.surface = { ...(object.surface ?? {}), fill: args.fill };
          if (args.icon && args.kind === 'button') object.icon = args.icon;
          if (args.label !== undefined) {
            if (args.kind === 'button') {
              object.label = { ...(object.label ?? {}), text: args.label };
            } else if (args.kind === 'card') {
              object.title = { ...(object.title ?? {}), text: args.label };
            }
          }
          if (args.body !== undefined && args.kind === 'card') {
            object.body = { ...(object.body ?? {}), text: args.body };
          }

          objectId = object.id;
          const next = { ...scene, objects: engine.addObject(scene.objects ?? [], object, null) };
          return replaceScene(project, index, next);
        });

        return ok({ objectId, scene: sceneResult(stored, args.sceneId, engine) });
      }),
    ),
  );

  server.registerTool(
    'update_shape',
    {
      title: 'Update shape',
      description:
        'Change a graphic object\'s geometry, fill, label or timing. Works on objects at any ' +
        'depth, including children of a card or group. Use apply_motion_style for its motion.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        objectId: s.elementId,
        x: z.number().min(-1).max(2).optional(),
        y: z.number().min(-1).max(2).optional(),
        width: z.number().min(0.005).max(3).optional(),
        height: z.number().min(0.005).max(3).optional(),
        rotation: z.number().min(-360).max(360).optional().describe('Degrees.'),
        opacity: z.number().min(0).max(1).optional(),
        fill: s.hexColor.optional(),
        label: z.string().max(200).optional(),
        layer: z.number().int().min(-10).max(10).optional(),
        start: z.number().min(0).max(60).optional(),
        duration: z.number().min(0.05).max(60).optional().describe('Seconds. Omitted means the rest of the scene.'),
      },
    },
    guard(async (args) => {
      const geometry = definedOnly({
        x: args.x, y: args.y, width: args.width, height: args.height,
        rotation: args.rotation, opacity: args.opacity,
        layer: args.layer, start: args.start, duration: args.duration,
      });
      if (Object.keys(geometry).length === 0 && args.fill === undefined && args.label === undefined) {
        throw validationError('Nothing to change — pass at least one field.');
      }

      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        const existing = engine.findObject(scene.objects ?? [], args.objectId);
        if (!existing) {
          throw notFound(`Object ${args.objectId} is not in scene ${args.sceneId}.`, {
            objectId: args.objectId,
            availableObjectIds: engine
              .flattenObjects(scene.objects ?? [])
              .map((row) => row.object.id),
          });
        }

        const patch = { ...geometry };
        if (args.fill) patch.surface = { ...(existing.surface ?? {}), fill: args.fill };
        if (args.label !== undefined) {
          if (existing.type === 'button') patch.label = { ...(existing.label ?? {}), text: args.label };
          else if (existing.type === 'card') patch.title = { ...(existing.title ?? {}), text: args.label };
          else {
            throw validationError(
              `A ${existing.type} has no label. Only buttons and cards carry text.`,
              { objectId: args.objectId, type: existing.type },
            );
          }
        }

        const next = { ...scene, objects: engine.updateObject(scene.objects ?? [], args.objectId, patch) };
        return replaceScene(project, index, next);
      });

      return ok({ scene: sceneResult(stored, args.sceneId, engine) });
    }),
  );

  /* ---------------------------------------------------------------- remove */

  server.registerTool(
    'remove_element',
    {
      title: 'Remove element',
      description:
        'Delete a text element or a graphic object by id — it finds whichever list the id ' +
        'is in. Destructive: requires `confirm: true`. Removing the last text element of a ' +
        'scene is allowed; the scene keeps its plain text so it still renders.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        elementId: s.elementId.describe('A text element id or an object id.'),
        confirm: s.confirm,
      },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    guard(async (args) => {
      const before = await readProject(args.projectId);
      const { scene } = requireScene(before.project, args.sceneId);

      const isText = (scene.elements ?? []).some((el) => el.id === args.elementId);
      const asObject = engine.findObject(scene.objects ?? [], args.elementId);
      if (!isText && !asObject) {
        throw notFound(`Nothing with id ${args.elementId} is in scene ${args.sceneId}.`, {
          availableElementIds: (scene.elements ?? []).map((el) => el.id),
          availableObjectIds: engine.flattenObjects(scene.objects ?? []).map((row) => row.object.id),
        });
      }

      if (args.confirm !== true) {
        const what = isText
          ? `text "${(scene.elements ?? []).find((el) => el.id === args.elementId).text.slice(0, 40)}"`
          : `${asObject.type} object`;
        throw confirmationRequired(
          `This deletes the ${what} and cannot be undone. Re-send with confirm: true.`,
          { elementId: args.elementId, kind: isText ? 'text' : 'object' },
        );
      }

      const stored = await mutateProject(args.projectId, (project) => {
        const { scene: live, index } = requireScene(project, args.sceneId);
        if (isText) {
          const remaining = (live.elements ?? []).filter((el) => el.id !== args.elementId);
          /* Drop the key entirely when the last element goes: an empty
             `elements` array would read as "a composition with nothing in it"
             and the scene would render blank, where no key at all correctly
             means "fall back to the scene's own text". */
          const next = remaining.length > 0
            ? syncSceneText({ ...live, elements: remaining })
            : (({ elements, ...rest }) => rest)(live);
          return replaceScene(project, index, next);
        }
        const next = { ...live, objects: engine.removeObject(live.objects ?? [], args.elementId) };
        return replaceScene(project, index, next);
      });

      return ok({ removed: args.elementId, scene: sceneResult(stored, args.sceneId, engine) });
    }),
  );
};
