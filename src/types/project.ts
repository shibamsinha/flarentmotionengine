/**
 * A project — everything the editor needs to open.
 *
 * V5 gives the app three ways in (blank, imported JSON, template) and this is
 * the shape all three collapse to. The editor takes one of these and has no way
 * to tell which door it came through, which is the whole point: the start flow
 * decides *what* to open, never *how* the editor behaves once it is open.
 *
 * The fields are exactly the auto-save's payload minus its bookkeeping, so
 * `PersistedProject` in `utils/persistence.ts` is this plus `version`/`savedAt`.
 * Keeping them aligned means a restored session and a fresh one are the same
 * object to everything downstream.
 */

import type { CanvasFormat, OverlayImage, PaletteName, Scene } from './scene';
import type { FieldOverrides } from '../utils/typography';
import type { ProjectAudio } from './audio';

export type Project = {
  scenes: Scene[];
  palette: PaletteName;
  /** Portrait unless the project chose landscape. */
  format: CanvasFormat;
  fields: FieldOverrides;
  overlay: OverlayImage | null;
  /**
   * V7 — one audio track for the whole video. Project-level by design: it is
   * positioned on the project clock, so scenes can be re-timed underneath it
   * without moving it.
   */
  audio: ProjectAudio | null;
  title: string | null;
  /** Which scene the editor should open on. Null means "the first one". */
  selectedId: string | null;
};

/**
 * How the open project was started. Carried only so the editor can be opened
 * without re-deriving it; nothing in the editor branches on this.
 */
export type ProjectOrigin = 'scratch' | 'import' | 'template' | 'resumed';
