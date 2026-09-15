/**
 * Rendering tools.
 *
 * Two very different operations, deliberately shaped differently:
 *
 *  - **`render_preview`** renders one frame and returns it as an image the model
 *    can actually see. This is what closes the create → look → critique → modify
 *    loop, and it is why the still endpoint was added to the render server.
 *    Flarent does the rendering; the *client* does the looking. Nothing here
 *    tries to judge a frame, because a visual critique invented server-side
 *    would be exactly the fake capability §24 warns about.
 *
 *  - **`render_video`** starts a job and returns immediately. Rendering an MP4
 *    takes minutes, so blocking would hit every client timeout there is. The
 *    caller polls `get_render_status`.
 *
 * Both go through the render server that already exists, so an MP4 produced over
 * MCP is byte-for-byte the one the editor's own Export button produces.
 */

import fsp from 'node:fs/promises';
import { z } from 'zod';

import { guard, ok, renderFailed, validationError } from '../lib/errors.mjs';
import { once } from '../lib/idempotency.mjs';
import { readProject } from '../lib/store.mjs';
import { round } from '../lib/summary.mjs';
import {
  BASE,
  cancelRender,
  health,
  outPath,
  renderPayload,
  renderStatus,
  renderContactSheet,
  renderStill,
  startRender,
} from '../lib/render-client.mjs';

/** Big enough that a model should not be handed it inline. */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

export const registerRenderTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  server.registerTool(
    'render_preview',
    {
      title: 'Render preview',
      description:
        'Render a single frame and return it as an image you can look at. Use this to check ' +
        'your work — composition, colour, whether the type fits — then modify and preview ' +
        'again. Pick the frame with `sceneId` (the middle of that scene) or `atSecond`; with ' +
        'neither it takes the middle of the whole video. Note frame 0 of every reel is blank ' +
        'by design, since entrances start at zero opacity.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId.optional().describe('Preview the middle of this scene.'),
        atSecond: z.number().min(0).max(3600).optional().describe('Preview this moment in the video.'),
      },
    },
    guard(async (args) => {
      if (args.sceneId && args.atSecond !== undefined) {
        throw validationError('Pass either `sceneId` or `atSecond`, not both.');
      }

      const stored = await readProject(args.projectId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
      const total = engine.totalFrames(stored.project.scenes, canvas.fps);

      let frame;
      if (args.sceneId) {
        const entry = timeline.find((row) => row.scene.id === args.sceneId);
        if (!entry) {
          throw validationError(`Scene ${args.sceneId} is not in this project.`, {
            availableSceneIds: stored.project.scenes.map((scene) => scene.id),
          });
        }
        // Middle of the scene: past the entrance, before any exit.
        frame = entry.from + Math.floor(entry.durationInFrames / 2);
      } else if (args.atSecond !== undefined) {
        frame = Math.min(total - 1, Math.round(args.atSecond * canvas.fps));
      } else {
        frame = Math.floor(total / 2);
      }

      const result = await renderStill({ ...renderPayload(stored.project), frame });

      // The server returns a filename; the absolute path is resolved locally,
      // because the render server no longer hands paths to any client.
      const file = outPath(result.filename);
      const bytes = await fsp.readFile(file);
      if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
        // Better to say where the file is than to push megabytes of base64
        // through the model's context.
        return ok({
          rendered: true,
          tooLargeToInline: true,
          path: file,
          bytes: bytes.length,
          frame: result.frame,
          note: 'The frame rendered but is too large to return inline. Open the file directly.',
        });
      }

      const atSecond = round(result.frame / canvas.fps);
      const scene = timeline.find(
        (row) => result.frame >= row.from && result.frame < row.from + row.durationInFrames,
      );

      /* An image block plus a text block: the model sees the frame, and the
         caption tells it *what* it is looking at. Without the caption it has a
         picture with no idea which scene or moment produced it. */
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              frame: result.frame,
              atSecond,
              sceneId: scene?.scene.id ?? null,
              sceneIndex: scene?.index ?? null,
              width: result.width,
              height: result.height,
              totalFrames: result.durationInFrames,
            }, null, 2),
          },
          { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
        ],
      };
    }),
  );


  server.registerTool(
    'render_contact_sheet',
    {
      title: 'Render contact sheet',
      description:
        'Render several frames at once and return them tiled into a single image — a ' +
        'storyboard of the reel. Far better than a run of render_preview calls for judging ' +
        'a whole film: one image, one look, and only the frames you asked for are rendered ' +
        '(a nine-cell sheet of a 600-frame reel renders nine frames, not 600).\n' +
        'By default it takes the midpoint of every scene, which is the useful default ' +
        'because frame 0 of each scene is mid-entrance. Narrow it with `sceneIds` or a ' +
        'scene index range, or ask for exact `frames`.\n' +
        'Cell positions come back in `cells`, mapped to scene and frame, so you can say ' +
        'which cell you are talking about.',
      inputSchema: {
        projectId: s.projectId,
        sceneIds: z.array(s.sceneId).min(1).max(36).optional().describe('Only these scenes.'),
        fromIndex: z.number().int().min(0).optional().describe('First scene index, inclusive.'),
        toIndex: z.number().int().min(0).optional().describe('Last scene index, inclusive.'),
        frames: z
          .array(z.number().int().min(0))
          .min(1)
          .max(36)
          .optional()
          .describe('Exact absolute frame numbers. Overrides the scene selection.'),
        columns: z.number().int().min(1).max(6).optional().describe('Grid width. Defaults to roughly square.'),
      },
    },
    guard(async (args) => {
      const stored = await readProject(args.projectId);
      const canvas = engine.canvasFor(stored.project.format);
      const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);

      /*
       * Which frames to draw.
       *
       * The midpoint of a scene is chosen deliberately: it is past the entrance
       * and before any exit, so a cell shows the scene as it *reads* rather than
       * mid-transition. `frames` is the escape hatch for looking at a specific
       * moment.
       */
      let picked;
      let labels;
      if (args.frames) {
        picked = args.frames;
        labels = args.frames.map((frame) => {
          const entry = timeline.find(
            (row) => frame >= row.from && frame < row.from + row.durationInFrames,
          );
          return { sceneId: entry?.scene.id ?? null, sceneIndex: entry?.index ?? null };
        });
      } else {
        let rows = timeline;
        if (args.sceneIds) {
          const wanted = new Set(args.sceneIds);
          const missing = args.sceneIds.filter(
            (id) => !timeline.some((row) => row.scene.id === id),
          );
          if (missing.length) {
            throw validationError(`Unknown scene id(s): ${missing.join(', ')}.`, {
              availableSceneIds: timeline.map((row) => row.scene.id),
            });
          }
          rows = timeline.filter((row) => wanted.has(row.scene.id));
        } else if (args.fromIndex !== undefined || args.toIndex !== undefined) {
          const from = args.fromIndex ?? 0;
          const to = args.toIndex ?? timeline.length - 1;
          if (from > to) throw validationError(`fromIndex ${from} is after toIndex ${to}.`);
          rows = timeline.filter((row) => row.index >= from && row.index <= to);
        }

        if (rows.length === 0) throw validationError('That selection matched no scenes.');
        if (rows.length > 36) {
          throw validationError(
            `A sheet holds at most 36 cells; that selection is ${rows.length} scenes. ` +
              'Narrow it with fromIndex/toIndex.',
            { selected: rows.length },
          );
        }

        picked = rows.map((row) => row.from + Math.floor(row.durationInFrames / 2));
        labels = rows.map((row) => ({ sceneId: row.scene.id, sceneIndex: row.index }));
      }

      const sheet = await renderContactSheet({
        ...renderPayload(stored.project),
        frames: picked,
        ...(args.columns ? { columns: args.columns } : {}),
      });

      const file = outPath(sheet.filename);
      const bytes = await fsp.readFile(file);
      const cells = sheet.cells.map((cell, i) => ({
        ...cell,
        atSecond: round(cell.frame / canvas.fps),
        ...(labels[i] ?? {}),
      }));

      if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
        return ok({
          rendered: true,
          tooLargeToInline: true,
          path: file,
          bytes: bytes.length,
          cells,
          note: 'The sheet rendered but is too large to return inline. Open the file directly.',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              cellCount: cells.length,
              columns: sheet.columns,
              rows: sheet.rows,
              width: sheet.width,
              height: sheet.height,
              cells,
            }, null, 2),
          },
          { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
        ],
      };
    }),
  );

  server.registerTool(
    'render_video',
    {
      title: 'Render video',
      description:
        'Start rendering the project to an H.264 MP4. Returns a jobId immediately — ' +
        'rendering takes minutes, so poll get_render_status rather than waiting. Pass an ' +
        'idempotencyKey so a retry cannot start a second render of the same thing.',
      inputSchema: { projectId: s.projectId, idempotencyKey: s.idempotencyKey },
    },
    guard(async (args) =>
      once('render_video', args.idempotencyKey, async () => {
        const stored = await readProject(args.projectId);
        const canvas = engine.canvasFor(stored.project.format);
        const { jobId } = await startRender(renderPayload(stored.project));

        return ok({
          jobId,
          status: 'queued',
          projectId: args.projectId,
          frames: engine.totalFrames(stored.project.scenes, canvas.fps),
          estimatedDuration: round(engine.totalSeconds(stored.project.scenes, canvas.fps)),
          note: 'Poll get_render_status with this jobId.',
        });
      }),
    ),
  );

  server.registerTool(
    'get_render_status',
    {
      title: 'Get render status',
      description:
        'Progress of a render job. `status` is one of starting, browser, bundling, ' +
        'rendering, done, cancelled or error; `progress` is 0–1. When it is done, call ' +
        'get_render_result for the file.',
      inputSchema: { jobId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const job = await renderStatus(args.jobId);
      return ok({
        jobId: args.jobId,
        status: job.status,
        progress: typeof job.progress === 'number' ? round(job.progress, 3) : 0,
        ...(job.message ? { message: job.message } : {}),
        ...(job.status === 'done' ? { filename: job.filename, ms: job.ms } : {}),
        retryable: job.status === 'error',
      });
    }),
  );

  server.registerTool(
    'get_render_result',
    {
      title: 'Get render result',
      description:
        'The finished MP4 for a completed job: its filename, the path on disk and the URL ' +
        'the render server serves it from. Fails if the job is still running or failed — ' +
        'check get_render_status first.',
      inputSchema: { jobId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      const job = await renderStatus(args.jobId);
      if (job.status !== 'done') {
        throw renderFailed(
          job.status === 'error'
            ? `That render failed: ${job.message ?? 'no message'}`
            : `That render is not finished — it is "${job.status}" at ${Math.round((job.progress ?? 0) * 100)}%.`,
          { jobId: args.jobId, status: job.status },
        );
      }
      return ok({
        jobId: args.jobId,
        filename: job.filename,
        url: `${BASE}${job.url}`,
        durationInFrames: job.durationInFrames,
        renderMs: job.ms,
      });
    }),
  );

  server.registerTool(
    'cancel_render',
    {
      title: 'Cancel render',
      description:
        'Stop a running render. Uses the renderer\'s own cancel signal so the headless ' +
        'browser and the partial file are cleaned up. A job that has already finished ' +
        'cannot be cancelled.',
      inputSchema: { jobId: z.string().min(1) },
    },
    guard(async (args) => ok(await cancelRender(args.jobId))),
  );

  server.registerTool(
    'render_server_health',
    {
      title: 'Render server health',
      description:
        'Whether the Flarent render server is running. Rendering and previews need it; ' +
        'everything else works without it. Call this first if a render fails to start.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const state = await health();
      return ok({ reachable: true, baseUrl: BASE, bundled: state.bundled === true });
    }),
  );
};
