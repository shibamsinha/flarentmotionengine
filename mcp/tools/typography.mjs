/**
 * Typography tools.
 *
 * Flarent's typography is **semantic, not CSS**. There is one house typeface,
 * weights are fixed per role, and there are no `letter-spacing` or `line-height`
 * controls to set. What exists instead is a small vocabulary of meaning —
 * a role, a size preset, a position, a composition — from which the engine
 * derives every actual number, measured against the reference video.
 *
 * That is a better interface for a model than raw CSS would be, and it is also
 * the only honest one: tools named `set_font_weight` or `set_letter_spacing`
 * would have nothing to write to. They are deliberately absent, and asking for
 * them returns UNSUPPORTED_CAPABILITY with a pointer to what to use instead.
 *
 * `apply_typography_style` is the tool to reach for. It turns one intent —
 * "make this the hero line" — into the role, size and case that intent implies,
 * so a model expresses what it wants rather than assembling four fields and
 * hoping they agree.
 */

import { z } from 'zod';

import { guard, ok, unsupported, validationError } from '../lib/errors.mjs';
import { definedOnly, replaceElement, replaceScene, requireElement, requireScene } from '../lib/scenes.mjs';
import { mutateProject } from '../lib/store.mjs';
import { sceneDetail } from '../lib/summary.mjs';

/**
 * Named intents, each a fixed set of semantic properties.
 *
 * The mapping is a constant table rather than anything inferred, so the same
 * intent always produces the same document — which is what makes a model's
 * output reproducible and reviewable. Adding a style means adding a row here,
 * and every value in a row is one the engine already understands.
 */
const STYLES = {
  hero: {
    role: 'primary', size: 'oversized', case: 'upper',
    describe: 'The line the whole scene is about. Biggest type, set in caps.',
  },
  statement: {
    role: 'primary', size: 'huge', case: 'as-typed',
    describe: 'A strong primary line that still reads as a sentence.',
  },
  emphasis: {
    role: 'emphasis', size: 'large', case: 'upper',
    describe: 'The word that lands. Accent-coloured by the palette, set in caps.',
  },
  kicker: {
    role: 'secondary', size: 'xs', case: 'upper',
    describe: 'A small line above the statement — a label or category.',
  },
  body: {
    role: 'support', size: 'medium', case: 'lower',
    describe: 'Ordinary supporting copy at a readable size.',
  },
  caption: {
    role: 'support', size: 'small', case: 'lower',
    describe: 'Secondary detail, deliberately quiet.',
  },
  whisper: {
    role: 'support', size: 'xs', case: 'lower',
    describe: 'The smallest step — a footnote or an aside.',
  },
};

/** Tools the original brief asked for that have nothing to map onto. */
const UNSUPPORTED_PROPERTIES = {
  font: 'Flarent ships one typeface (Flarent Grotesk, falling back to Inter). There is no font picker.',
  fontFamily: 'Flarent ships one typeface. There is no font picker.',
  fontWeight: 'Weight is fixed per role — a primary line is already heavier than a support line. Use `role` or apply_typography_style.',
  letterSpacing: 'Tracking is art-directed per size preset and is not settable.',
  lineHeight: 'Leading is derived from the measured font metrics and is not settable.',
};

export const registerTypographyTools = (server, ctx) => {
  const { engine, schemas: s } = ctx;

  const sceneResult = (stored, sceneId) => {
    const { index } = requireScene(stored.project, sceneId);
    const canvas = engine.canvasFor(stored.project.format);
    const timeline = engine.buildTimeline(stored.project.scenes, canvas.fps);
    return sceneDetail(stored.project.scenes[index], timeline[index]);
  };

  /**
   * Patch one element, or every element in the scene when no id is given.
   *
   * "Apply this to the whole scene" is a common intent and doing it one call per
   * element would be several round trips for the model and several writes for
   * the disk.
   */
  const patchElements = async (args, patch) =>
    mutateProject(args.projectId, (project) => {
      const { scene, index } = requireScene(project, args.sceneId);
      const elements = scene.elements ?? [];

      if (elements.length === 0) {
        throw validationError(
          `Scene ${args.sceneId} has no text elements to style. Add one with add_text first — ` +
            'a scene\'s plain `text` is styled by the scene\'s own settings, not per element.',
          { sceneId: args.sceneId },
        );
      }

      if (args.elementId) {
        const { element, index: at } = requireElement(scene, args.elementId);
        return replaceScene(project, index, replaceElement(scene, at, { ...element, ...patch }));
      }
      return replaceScene(project, index, {
        ...scene,
        elements: elements.map((element) => ({ ...element, ...patch })),
      });
    });

  server.registerTool(
    'apply_typography_style',
    {
      title: 'Apply typography style',
      description:
        'Set a text element\'s typography from one named intent rather than field by field. ' +
        'Each style maps to a fixed role, size and case, so the result is deterministic. ' +
        'Omit `elementId` to apply it to every element in the scene. This is the preferred ' +
        'typography tool — reach for the set_text_* tools only to adjust one property.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        elementId: s.elementId.optional().describe('Omit to style every element in the scene.'),
        style: z
          .enum(Object.keys(STYLES))
          .describe(
            Object.entries(STYLES)
              .map(([name, spec]) => `${name}: ${spec.describe}`)
              .join(' | '),
          ),
        size: s.size.optional().describe('Override the size this style implies.'),
        case: s.textCase.optional().describe('Override the case this style implies.'),
      },
    },
    guard(async (args) => {
      const spec = STYLES[args.style];
      const patch = {
        role: spec.role,
        size: args.size ?? spec.size,
        case: args.case ?? spec.case,
      };
      const stored = await patchElements(args, patch);
      return ok({ applied: { style: args.style, ...patch }, scene: sceneResult(stored, args.sceneId) });
    }),
  );

  server.registerTool(
    'set_text_role',
    {
      title: 'Set text role',
      description:
        'Set an element\'s semantic role. The role decides its default size and weight and ' +
        'whether the palette paints it in the accent colour (emphasis does).',
      inputSchema: {
        projectId: s.projectId, sceneId: s.sceneId,
        elementId: s.elementId.optional(), role: s.role,
      },
    },
    guard(async (args) =>
      ok({ scene: sceneResult(await patchElements(args, { role: args.role }), args.sceneId) }),
    ),
  );

  server.registerTool(
    'set_text_size',
    {
      title: 'Set text size',
      description:
        'Set an element\'s size preset. Sizes are semantic steps, not pixels — the engine ' +
        'resolves each one against the frame so it is correct in portrait and landscape.',
      inputSchema: {
        projectId: s.projectId, sceneId: s.sceneId,
        elementId: s.elementId.optional(), size: s.size,
      },
    },
    guard(async (args) =>
      ok({ scene: sceneResult(await patchElements(args, { size: args.size }), args.sceneId) }),
    ),
  );

  server.registerTool(
    'set_text_position',
    {
      title: 'Set text position',
      description:
        'Place an element explicitly, overriding the scene composition. The `offscreen-*` ' +
        'positions are entrance origins — type thrown in from beyond the frame edge.',
      inputSchema: {
        projectId: s.projectId, sceneId: s.sceneId,
        elementId: s.elementId.optional(), position: s.position,
      },
    },
    guard(async (args) =>
      ok({ scene: sceneResult(await patchElements(args, { position: args.position }), args.sceneId) }),
    ),
  );

  server.registerTool(
    'set_text_alignment',
    {
      title: 'Set text alignment',
      description: 'Set horizontal alignment for an element, or for every element in the scene.',
      inputSchema: {
        projectId: s.projectId, sceneId: s.sceneId,
        elementId: s.elementId.optional(), align: s.alignment,
      },
    },
    guard(async (args) =>
      ok({ scene: sceneResult(await patchElements(args, { align: args.align }), args.sceneId) }),
    ),
  );

  server.registerTool(
    'set_text_case',
    {
      title: 'Set text case',
      description:
        'Set letter case. "as-typed" preserves exactly what was written, which matters when ' +
        'the copy carries a proper noun or an acronym.',
      inputSchema: {
        projectId: s.projectId, sceneId: s.sceneId,
        elementId: s.elementId.optional(), case: s.textCase,
      },
    },
    guard(async (args) =>
      ok({ scene: sceneResult(await patchElements(args, { case: args.case }), args.sceneId) }),
    ),
  );

  server.registerTool(
    'set_text_composition',
    {
      title: 'Set text composition',
      description:
        'Set how a scene arranges its text elements — this is scene-level, not per element. ' +
        'The composition supplies each element a position, so it is the tool to reach for ' +
        'before placing elements by hand.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        composition: s.composition,
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        return replaceScene(project, index, { ...scene, composition: args.composition });
      });
      return ok({ scene: sceneResult(stored, args.sceneId) });
    }),
  );

  server.registerTool(
    'set_word_colors',
    {
      title: 'Set word colours',
      description:
        'Colour individual words within a scene, by word. Matching is case-insensitive and ' +
        'applies wherever the word appears in that scene. This is Flarent\'s real per-word ' +
        'colour feature; for the palette\'s own accent treatment use emphasis instead.',
      inputSchema: {
        projectId: s.projectId,
        sceneId: s.sceneId,
        colors: z
          .record(z.string().min(1), s.hexColor)
          .describe('Map of word to hex colour, e.g. { "discipline": "#4ADE6A" }.'),
        replace: z
          .boolean()
          .optional()
          .describe('True to replace the whole map. Default merges into what is there.'),
      },
    },
    guard(async (args) => {
      const stored = await mutateProject(args.projectId, (project) => {
        const { scene, index } = requireScene(project, args.sceneId);
        const merged = args.replace
          ? args.colors
          : { ...(scene.wordColors ?? {}), ...args.colors };
        return replaceScene(project, index, { ...scene, wordColors: merged });
      });
      return ok({ scene: sceneResult(stored, args.sceneId) });
    }),
  );

  /**
   * A deliberate dead end.
   *
   * A model that has been trained on CSS will reach for `set_font_weight`. Rather
   * than let that fail as "unknown tool" — which invites retrying variations —
   * this answers once, clearly, and names the tool to use instead.
   */
  server.registerTool(
    'set_font_property',
    {
      title: 'Set font property (unsupported)',
      description:
        'NOT SUPPORTED. Flarent has no per-property typography: one typeface, weights fixed ' +
        'per role, tracking and leading art-directed per size. Call this only to confirm ' +
        'that; use apply_typography_style, set_text_role or set_text_size to change how type ' +
        'looks.',
      inputSchema: {
        property: z.enum(Object.keys(UNSUPPORTED_PROPERTIES)).describe('The property you were reaching for.'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => {
      throw unsupported(UNSUPPORTED_PROPERTIES[args.property], {
        property: args.property,
        useInstead: ['apply_typography_style', 'set_text_role', 'set_text_size'],
      });
    }),
  );
};
