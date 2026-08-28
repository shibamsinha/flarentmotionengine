/**
 * Startup.
 *
 * V5 put a launch sequence in front of the editor, and this is the only place
 * that knows about it:
 *
 *     APP_LOADING → SPLASH → START_SCREEN → EDITOR
 *
 * The states are one discriminated union rather than a handful of booleans
 * scattered about, so "what is on screen" is always a single value and the
 * editor cannot be reached except by handing it a project.
 *
 * **The startup state is deterministic.** `phase` starts on `splash` — never on
 * a value derived from storage — so a reload cannot flash the editor before the
 * splash paints. The editor is not mounted at all until a project exists, which
 * is a stronger guarantee than hiding it with CSS.
 *
 * **A reload does not silently reopen the last project.** The brief asks for the
 * start screen on every entry. That is not the same as discarding the work: the
 * auto-save is read once here, before the editor can mount and overwrite it, and
 * offered back on the start screen. Nothing is cleared on the way through.
 */

import React, { useState } from 'react';
import type { Project, ProjectOrigin } from './types/project';
import { loadProject } from './utils/persistence';
import { Splash } from './components/start/Splash';
import { StartScreen } from './components/start/StartScreen';
import { Editor } from './Editor';

/**
 * Read at module scope, on purpose: this is the auto-save as it stood when the
 * page loaded. Reading it later would race the editor's own first save, and the
 * "resume" offer would describe a project the user had already replaced.
 */
const restored = loadProject();

type Phase =
  | { kind: 'splash' }
  | { kind: 'start' }
  | { kind: 'editor'; project: Project; origin: ProjectOrigin };

export const App: React.FC = () => {
  const [phase, setPhase] = useState<Phase>({ kind: 'splash' });

  if (phase.kind === 'splash') {
    return <Splash onDone={() => setPhase({ kind: 'start' })} />;
  }

  if (phase.kind === 'start') {
    return (
      <StartScreen
        resumable={restored}
        onOpen={(project, origin) => setPhase({ kind: 'editor', project, origin })}
      />
    );
  }

  /**
   * Keyed by origin so that choosing a different starting point after coming
   * back to this screen remounts the editor with fresh state rather than
   * leaving the previous project's scenes in place. Within one session the key
   * is stable, so the editor is never remounted underneath a working user.
   */
  return <Editor key={phase.origin} initial={phase.project} />;
};
