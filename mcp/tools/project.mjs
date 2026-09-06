/**
 * Project tools.
 *
 * A project here is a file in `.flarent/projects/` holding exactly what the
 * editor's "Extract" button produces, which is why anything created over MCP can
 * be opened in the editor through its existing Import door.
 *
 * One shape recurs and is worth stating once: a project must always hold at
 * least one scene. Remotion cannot mount a zero-frame composition and the
 * importer rejects an empty list outright, so `create_project` seeds a scene
 * when the caller supplies none — the same choice `createBlankProject` makes in
 * the editor, for the same reason.
 */

import { z } from 'zod';

import { confirmationRequired, guard, ok, validationError } from '../lib/errors.mjs';
import { once } from '../lib/idempotency.mjs';
import { projectSummary } from '../lib/summary.mjs';
import {
  createProject,
  deleteProject,
  listProjects,
  mutateProject,
  newProjectId,
  readProject,
} from '../lib/store.mjs';

export const registerProjectTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a new Flarent project and return its id. Pass `scenes` when you already ' +
        'know the copy — it avoids the placeholder scene that is otherwise created, since ' +
        'a project can never have zero scenes. Use `template` to start from a built-in ' +
        'Reference Reel instead. Returns a project summary.',
      inputSchema: {
        title: z.string().min(1).max(200).optional().describe('Human-readable name.'),
        format: s.format.optional().describe('Frame shape. Portrait 1080x1920 unless set.'),
        scenes: z
          .array(
            z.object({
              text: z.string().min(1).describe('Scene copy. Newlines separate lines.'),
              duration: s.duration.optional(),
              style: s.animationStyle.optional(),
              background: s.background.optional(),
            }),
          )
          .min(1)
          .max(60)
          .optional()
          .describe('Initial scenes, in order.'),
        template: z
          .string()
          .optional()
          .describe('Id of a built-in template. Call list_templates to see them.'),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('create_project', args.idempotencyKey, async () => {
        if (args.template && args.scenes) {
          throw validationError('Pass either `template` or `scenes`, not both.');
        }

        let scenes;
        if (args.template) {
          const preset = engine.PRESETS.find((p) => p.id === args.template);
          if (!preset) {
            throw validationError(`Unknown template "${args.template}".`, {
              available: engine.PRESETS.map((p) => p.id),
            });
          }
          scenes = preset.build();
        } else if (args.scenes) {
          scenes = args.scenes.map((scene) =>
            engine.blankScene({
              text: scene.text,
              ...(scene.duration !== undefined ? { duration: scene.duration } : {}),
              ...(scene.style ? { style: scene.style } : {}),
              ...(scene.background ? { background: scene.background } : {}),
            }),
          );
        } else {
          scenes = [engine.blankScene()];
        }

        const stored = await createProject(
          {
            scenes,
            title: args.title ?? null,
            format: args.format ?? 'portrait',
            fields: {},
            ink: {},
            accent: null,
            overlay: null,
            audio: null,
          },
          newProjectId(),
        );

        return ok({ project: projectSummary(stored, engine) });
      }),
    ),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Every stored project, newest first, as shallow rows (id, title, duration, scene ' +
        'count). Use this to find a project id; use inspect_project for detail.',
      inputSchema: {},
    },
    guard(async () => {
      const projects = await listProjects();
      return ok({ count: projects.length, projects });
    }),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'A project summary: format, duration, audio state and one row per scene. ' +
        'Identical to inspect_project; kept because it is the name a client reaches for first.',
      inputSchema: { projectId: s.projectId },
    },
    guard(async (args) =>
      ok({ project: projectSummary(await readProject(args.projectId), engine) }),
    ),
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description:
        'Change project-level settings: title and frame format. For colours use set_palette ' +
        '— the palette *name* (forest/ink) is derived from scene backgrounds and is not settable, ' +
        'but the colours themselves are.',
      inputSchema: {
        projectId: s.projectId,
        title: z.string().min(1).max(200).optional(),
        format: s.format.optional().describe('Changing this re-lays every scene on the new frame.'),
      },
    },
    guard(async (args) => {
      if (args.title === undefined && args.format === undefined) {
        throw validationError('Supply `title` or `format`.');
      }
      const stored = await mutateProject(args.projectId, (project) => ({
        ...project,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.format !== undefined ? { format: args.format } : {}),
      }));
      return ok({ project: projectSummary(stored, engine) });
    }),
  );

  server.registerTool(
    'set_palette',
    {
      title: 'Set palette',
      description:
        'Set the project\'s colours. `background` and `ink` are maps keyed by field name ' +
        '(green / cream / black) so a scene keeps saying which *field* it is on while the ' +
        'project decides what that field looks like — which is why "background #1A0DCC with ' +
        'white text" is two entries here rather than a colour on every scene.\n' +
        'An explicit ink is honoured exactly; leave it out and the engine derives a readable ' +
        'one automatically. `accent` is one project-wide colour. Pass null for any of them to ' +
        'clear it and return to the house palette.',
      inputSchema: {
        projectId: s.projectId,
        /* Spelled out as three optional keys rather than a record over the
           enum: a record demands every key, and the point of these maps is that
           a project overrides one field and leaves the others alone. Writing
           them out also puts the legal field names in the schema, where a model
           will actually read them. */
        background: z
          .object({
            green: s.hexColor.optional(),
            cream: s.hexColor.optional(),
            black: s.hexColor.optional(),
          })
          // Strict: an unknown field name is a mistake worth reporting, not a
          // key to silently drop — the same rule the importer applies.
          .strict()
          .nullable()
          .optional()
          .describe('Field colours, e.g. { "green": "#1A0DCC" }. Null clears them.'),
        ink: z
          .object({
            green: s.hexColor.optional(),
            cream: s.hexColor.optional(),
            black: s.hexColor.optional(),
          })
          .strict()
          .nullable()
          .optional()
          .describe('Text colour per field, e.g. { "green": "#FFFFFF" }. Honoured exactly.'),
        accent: s.hexColor.nullable().optional().describe('One project-wide accent colour.'),
        merge: z
          .boolean()
          .optional()
          .describe('Merge into the existing maps rather than replacing them. Default true.'),
      },
    },
    guard(async (args) => {
      if (args.background === undefined && args.ink === undefined && args.accent === undefined) {
        throw validationError('Pass at least one of `background`, `ink` or `accent`.');
      }
      const merge = args.merge !== false;

      const stored = await mutateProject(args.projectId, (project) => {
        const next = { ...project };
        if (args.background !== undefined) {
          next.fields = args.background === null
            ? {}
            : merge ? { ...project.fields, ...args.background } : { ...args.background };
        }
        if (args.ink !== undefined) {
          next.ink = args.ink === null
            ? {}
            : merge ? { ...project.ink, ...args.ink } : { ...args.ink };
        }
        if (args.accent !== undefined) next.accent = args.accent;
        return next;
      });

      const summary = projectSummary(stored, engine);
      return ok({ palette: summary.palette, project: summary });
    }),
  );

  server.registerTool(
    'duplicate_project',
    {
      title: 'Duplicate project',
      description:
        'Copy a project to a new id, leaving the original untouched. Useful before a ' +
        'risky change, and the safe alternative to delete_project.',
      inputSchema: {
        projectId: s.projectId,
        title: z.string().min(1).max(200).optional().describe('Title for the copy.'),
        idempotencyKey: s.idempotencyKey,
      },
    },
    guard(async (args) =>
      once('duplicate_project', args.idempotencyKey, async () => {
        const source = await readProject(args.projectId);
        const copy = await createProject(
          {
            ...source.project,
            title: args.title ?? (source.project.title ? `${source.project.title} copy` : null),
          },
          newProjectId(),
        );
        return ok({ project: projectSummary(copy, engine), copiedFrom: args.projectId });
      }),
    ),
  );

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description:
        'Permanently delete a project file. Destructive and irreversible: it refuses ' +
        'unless `confirm` is true, and there is no undo. Prefer duplicate_project if you ' +
        'only need a safe copy to experiment on.',
      inputSchema: { projectId: s.projectId, confirm: s.confirm },
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    guard(async (args) => {
      // Read first, so a bad id fails as NOT_FOUND rather than as a
      // confirmation prompt for something that was never there.
      const stored = await readProject(args.projectId);
      if (args.confirm !== true) {
        throw confirmationRequired(
          `This permanently deletes "${stored.project.title ?? args.projectId}" ` +
            `(${stored.project.scenes.length} scenes). Re-send with confirm: true to proceed.`,
          { projectId: args.projectId, sceneCount: stored.project.scenes.length },
        );
      }
      await deleteProject(args.projectId);
      return ok({ deleted: args.projectId });
    }),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description:
        'The built-in Reference Reels that create_project accepts as `template`. These are ' +
        'the engine\'s own demo reels, useful as a starting point or as a style reference.',
      inputSchema: {},
    },
    guard(async () =>
      ok({
        templates: engine.PRESETS.map((preset) => ({
          id: preset.id,
          label: preset.label,
          note: preset.note,
        })),
      }),
    ),
  );
};
