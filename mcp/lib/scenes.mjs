/**
 * Locating things inside a project, and the small edits every tool shares.
 *
 * Scene and element lookup by id is the single most repeated operation in the
 * tool layer, and getting "not found" wrong is what makes a model flail: it
 * needs to know *which* id missed and what ids exist. Every helper here throws a
 * `NOT_FOUND` that names the id and lists the valid ones.
 *
 * Nothing in this file decides how anything looks or moves. It finds, replaces
 * and re-times — the engine owns everything else.
 */

import { notFound, validationError } from './errors.mjs';

/* ---------------------------------------------------------------- lookup */

export const requireScene = (project, sceneId) => {
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) {
    throw notFound(`Scene ${sceneId} is not in this project.`, {
      sceneId,
      availableSceneIds: project.scenes.map((scene) => scene.id),
    });
  }
  return { scene: project.scenes[index], index };
};

/**
 * Replace one scene, returning a new project.
 *
 * Immutable rewrite rather than in-place mutation for the same reason
 * `data/objects.ts` does it: the caller may be holding the old value, and a
 * silent shared mutation is the kind of bug that only shows up two tools later.
 */
export const replaceScene = (project, index, scene) => ({
  ...project,
  scenes: project.scenes.map((existing, i) => (i === index ? scene : existing)),
});

/**
 * A scene's text element by id.
 *
 * V3 elements only. Objects are a separate list with their own tree helpers in
 * the engine (`findObject`), and conflating them here would be the first step
 * towards the merged model the architecture deliberately avoids.
 */
export const requireElement = (scene, elementId) => {
  const elements = scene.elements ?? [];
  const index = elements.findIndex((element) => element.id === elementId);
  if (index === -1) {
    throw notFound(`Element ${elementId} is not in scene ${scene.id}.`, {
      elementId,
      sceneId: scene.id,
      availableElementIds: elements.map((element) => element.id),
    });
  }
  return { element: elements[index], index };
};

export const replaceElement = (scene, index, element) => ({
  ...scene,
  elements: (scene.elements ?? []).map((existing, i) => (i === index ? element : existing)),
});

/* ------------------------------------------------------------ text scenes */

/**
 * Keep `scene.text` consistent with `scene.elements`.
 *
 * A scene carries both a plain `text` (the V2 model) and an optional
 * `elements` list (V3). The renderer prefers elements when they exist, but
 * `text` is still what the export filename, the scene list and any pre-V3
 * consumer read — and the importer rejects a scene that has neither. Letting
 * them drift produces a project that renders one thing and reads as another,
 * so every tool that changes elements goes through here.
 */
export const syncSceneText = (scene) => {
  const elements = scene.elements ?? [];
  if (elements.length === 0) return scene;
  return { ...scene, text: elements.map((element) => element.text).join('\n') };
};

/**
 * Strip keys whose value is `undefined`.
 *
 * Tool arguments arrive with absent optionals as `undefined`, and spreading
 * those straight onto a scene would overwrite real values with nothing. Patches
 * are therefore always cleaned before they are applied.
 */
export const definedOnly = (patch) =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

/**
 * Apply a patch, refusing a no-op.
 *
 * A tool call that sets nothing is almost always a model mistake — it meant to
 * pass a field and passed none — and silently succeeding teaches it that the
 * call worked. Better to say so.
 */
export const requirePatch = (patch, hint) => {
  const clean = definedOnly(patch);
  if (Object.keys(clean).length === 0) {
    throw validationError(`Nothing to change — supply at least one field. ${hint}`);
  }
  return clean;
};
