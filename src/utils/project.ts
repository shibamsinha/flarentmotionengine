/**
 * The one place a project is created.
 *
 * V5's start screen offers three doors — blank, imported JSON, template — and
 * a fourth internal one for resuming an auto-save. All four land here so the
 * editor only ever receives a `Project` and never learns which door was used.
 * Adding a fifth way in later means adding a function here, not another branch
 * inside the editor.
 */

import type { Project } from '../types/project';
import type { Scene } from '../types/scene';
import { blankScene } from '../data/defaultScenes';
import { DEFAULT_FORMAT } from './timing';
import { DEFAULT_PALETTE } from './typography';
import type { ImportedProject } from './importScript';
import type { PersistedProject } from './persistence';
import type { Preset } from '../data/presets';

/**
 * Shared defaults. A project that does not say otherwise is a portrait reel in
 * the house palette with no overlay and no title.
 */
const base = (scenes: Scene[]): Project => ({
  scenes,
  palette: DEFAULT_PALETTE,
  format: DEFAULT_FORMAT,
  fields: {},
  overlay: null,
  title: null,
  selectedId: scenes[0]?.id ?? null,
});

/**
 * "Start from scratch" — one empty scene, not zero.
 *
 * Zero would be the more literal reading of "blank", but the composition's
 * length is the sum of its scenes, and Remotion cannot mount a zero-frame
 * composition: an empty list drops the editor onto a broken player instead of a
 * blank canvas. One `blankScene()` is also what the editor's own "add scene"
 * button produces, so a scratch project is indistinguishable from a reel whose
 * scenes were all deleted but one.
 */
export const createBlankProject = (): Project => base([blankScene()]);

/**
 * "Import JSON" — `parseFlarentScript` has already validated the whole document
 * by the time we get here, so this is a field copy and nothing else. Import is
 * all-or-nothing upstream; there is no half-valid project to repair.
 */
export const createProjectFromJSON = (imported: ImportedProject): Project => ({
  scenes: imported.scenes,
  palette: imported.palette,
  format: imported.format,
  fields: imported.fields,
  overlay: imported.overlay,
  title: imported.title,
  selectedId: imported.scenes[0]?.id ?? null,
});

/**
 * "Start from a template" — a Reference Reel becomes an ordinary editable
 * project.
 *
 * `preset.build()` constructs every scene, element and emphasis array fresh on
 * each call (ids come from `makeSceneId`/`makeElementId`, which mint new ones
 * every time), so the returned project shares no object with the preset. That
 * is what keeps the original template untouchable no matter what the user does
 * next — there is no shared structure to mutate, so no defensive copy is needed
 * here. Do not "optimise" the presets into pre-built constant arrays: that
 * would silently make every template editable in place.
 */
export const createProjectFromTemplate = (preset: Preset): Project => ({
  ...base(preset.build()),
  title: preset.label,
});

/**
 * Reopening the auto-save. Not one of the three advertised doors — it exists so
 * that choosing a starting point never has to mean losing the work already in
 * localStorage.
 */
export const createProjectFromPersisted = (saved: PersistedProject): Project => ({
  scenes: saved.scenes,
  palette: saved.palette,
  format: saved.format,
  fields: saved.fields,
  overlay: saved.overlay,
  title: saved.title,
  selectedId: saved.selectedId,
});
