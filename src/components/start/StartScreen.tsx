/**
 * "How do you want to start?"
 *
 * Three doors, equal weight, and nothing else to read. The whole screen is one
 * decision: the brief's measure of success is that a user reaches the editor in
 * seconds, so there is no tour, no account, no explainer modal, and no fourth
 * card competing for the same attention.
 *
 * Import opens the OS file picker straight from the card — no intermediate page
 * — and runs the same `parseFlarentScript` the editor's Import panel uses, so
 * there is one validator and one definition of a valid project. Nothing here
 * reimplements schema checking.
 *
 * The one addition beyond the three cards is the resume line under them, and it
 * is there for a specific reason: the brief requires that a reload land on this
 * screen and that existing saved work is not destroyed. Those two rules alone
 * would leave an auto-saved reel stranded — reachable by nothing, and
 * overwritten by the first auto-save after choosing "start from scratch". A
 * quiet secondary link resolves that without becoming a fourth primary choice.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { Project, ProjectOrigin } from '../../types/project';
import type { Preset } from '../../data/presets';
import type { PersistedProject } from '../../utils/persistence';
import { parseFlarentScript } from '../../utils/importScript';
import {
  createBlankProject,
  createProjectFromJSON,
  createProjectFromPersisted,
  createProjectFromTemplate,
} from '../../utils/project';
import { LOGO_MARK, SPLASH_WORDMARK } from '../editor/Logo';
import { TemplateBrowser } from './TemplateBrowser';
import { ParticleField } from './ParticleField';

/**
 * A failure the user can act on. Raw parser messages are kept out of the
 * headline and offered underneath, because "Unexpected token < in JSON at
 * position 0" is not a sentence anyone should have to read to learn they picked
 * the wrong file.
 */
type Failure = { title: string; hint: string; detail: string | null };

/**
 * `import` carries the pasted/loaded text and any failure with it, so a
 * rejected document stays on screen to be corrected rather than being thrown
 * away behind a full-screen error. Template failures keep the separate `failed`
 * view because there is nothing to correct in that case — only to retry.
 */
type View =
  | { kind: 'choose' }
  | { kind: 'templates' }
  | { kind: 'import'; text: string; failure: Failure | null }
  | { kind: 'busy'; label: string }
  | { kind: 'failed'; failure: Failure };

/**
 * The shell every start-flow view sits in.
 *
 * Three layers, back to front: a glow, the particle field, and a fade into the
 * bottom edge — the same recipe flarent.online uses behind its hero, so the two
 * surfaces read as one product.
 *
 * The backdrop is a sibling of the scrolling element rather than inside it. If
 * it lived in the scroller, `absolute inset-0` would pin it to the scroll
 * origin and the field would slide away as soon as the template grid scrolled.
 * `ParticleField` measures its own parent, so `.start-backdrop` is what defines
 * the field's bounds.
 */
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="start">
    <div className="start-backdrop" aria-hidden>
      <span className="start-glow" />
      <ParticleField />
      <span className="start-fade" />
    </div>
    <div className="start-scroll">{children}</div>
  </div>
);

const CARDS = [
  {
    id: 'scratch',
    kicker: 'Start from scratch',
    body: 'Build a motion piece from a blank canvas.',
    action: 'Start from scratch',
  },
  {
    id: 'import',
    kicker: 'Import JSON',
    body: 'Continue from an existing Motion Engine project.',
    action: 'Import JSON',
  },
  {
    id: 'template',
    kicker: 'Start from a template',
    body: 'Use a Reference Reel as your starting point.',
    action: 'Browse templates',
  },
] as const;

export const StartScreen: React.FC<{
  resumable: PersistedProject | null;
  onOpen: (project: Project, origin: ProjectOrigin) => void;
}> = ({ resumable, onOpen }) => {
  const [view, setView] = useState<View>({ kind: 'choose' });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fail = useCallback((failure: Failure) => {
    setView({ kind: 'failed', failure });
  }, []);

  /**
   * One import path. A file and a paste differ only in where the text came
   * from, so both end up here and get the same validation and the same words
   * when they fail — there is no way for the two to drift apart.
   */
  const runImport = useCallback(
    (source: string, origin: 'file' | 'paste') => {
      const text = source.trim();
      if (text === '') {
        setView({
          kind: 'import',
          text: source,
          failure: {
            title: 'Nothing to import.',
            hint: 'Choose a .json file, or paste a project below.',
            detail: null,
          },
        });
        return;
      }

      const result = parseFlarentScript(text);
      if (!result.ok) {
        const errors = result.issues.filter((i) => i.severity === 'error');
        setView({
          kind: 'import',
          // The document stays in the box so it can be corrected in place.
          text: source,
          failure: {
            title: "This isn't a valid Flarent Motion Engine project.",
            hint:
              origin === 'file'
                ? 'Check the file was extracted from the Motion Engine — or edit it below and import again.'
                : 'Fix the problems below and import again.',
            detail:
              errors
                .slice(0, 6)
                .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
                .join('\n') || null,
          },
        });
        return;
      }
      onOpen(createProjectFromJSON(result.project), 'import');
    },
    [onOpen],
  );

  const readFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;

      const reader = new FileReader();
      reader.onerror = () =>
        setView({
          kind: 'import',
          text: '',
          failure: {
            title: "That file couldn't be read.",
            hint: 'It may have been moved or renamed. Try again, or paste the project below.',
            detail: null,
          },
        });
      reader.onload = () => runImport(String(reader.result ?? ''), 'file');
      reader.readAsText(file);
    },
    [runImport],
  );

  /**
   * The picker is opened straight from the card so the fastest route is one
   * click, but the screen moves to the import view underneath it at the same
   * time. Cancelling the OS dialog therefore lands on somewhere useful — with
   * the paste box ready — instead of back on the three cards having achieved
   * nothing.
   */
  const beginImport = useCallback(() => {
    setView({ kind: 'import', text: '', failure: null });
    fileRef.current?.click();
  }, []);

  const useTemplate = useCallback(
    (preset: Preset) => {
      setView({ kind: 'busy', label: 'Loading template…' });
      // Deferred a frame so the busy state actually paints before `build()` and
      // the editor's first render occupy the main thread.
      window.setTimeout(() => {
        try {
          onOpen(createProjectFromTemplate(preset), 'template');
        } catch {
          fail({
            title: "This template couldn't be loaded.",
            hint: 'Please try again, or pick a different Reference Reel.',
            detail: null,
          });
        }
      }, 0);
    },
    [fail, onOpen],
  );

  /* The picker is always mounted so the click that opens it is the user's own
     gesture — deferring it behind a state change loses the user-activation a
     browser requires to open a file dialog. */
  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(event) => {
        readFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  if (view.kind === 'templates') {
    return (
      <Shell>
        {picker}
        <TemplateBrowser
          onUse={useTemplate}
          onBack={() => setView({ kind: 'choose' })}
        />
      </Shell>
    );
  }

  if (view.kind === 'busy') {
    return (
      <Shell>
        {picker}
        <div className="start-pane is-busy">
          <p className="start-busy">{view.label}</p>
        </div>
      </Shell>
    );
  }

  if (view.kind === 'import') {
    const { text, failure } = view;
    const setText = (next: string) =>
      // Editing clears the previous complaint — the errors described the old
      // text, and leaving them up makes them look like live validation.
      setView({ kind: 'import', text: next, failure: null });

    return (
      <Shell>
        {picker}
        <div className="start-pane">
          <div className="start-head">
            <button
              type="button"
              className="start-back"
              onClick={() => setView({ kind: 'choose' })}
            >
              ← Back
            </button>
            <h1 className="start-title">Import a project</h1>
            <p className="start-sub">
              Choose a <code>.json</code> file, or paste one straight in.
            </p>
          </div>

          <div className="import-panel">
            <button
              type="button"
              className={`dropzone${dragging ? ' is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                readFile(event.dataTransfer.files?.[0]);
              }}
            >
              Drop a .json file here, or click to choose one
            </button>

            <p className="import-or">or paste the JSON</p>

            <textarea
              className="text-input import-input"
              spellCheck={false}
              autoFocus
              placeholder={'{\n  "title": "…",\n  "scenes": [ … ]\n}'}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />

            {failure ? (
              <div className="import-failure">
                <p className="import-failure-title">{failure.title}</p>
                <p className="import-failure-hint">{failure.hint}</p>
                {failure.detail ? (
                  <pre className="start-detail">{failure.detail}</pre>
                ) : null}
              </div>
            ) : null}

            <div className="start-actions">
              <button
                type="button"
                className="btn primary"
                disabled={text.trim() === ''}
                onClick={() => runImport(text, 'paste')}
              >
                Import project
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setView({ kind: 'choose' })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (view.kind === 'failed') {
    const { failure } = view;
    return (
      <Shell>
        {picker}
        <div className="start-pane">
          <div className="start-head">
            <h1 className="start-title">{failure.title}</h1>
            <p className="start-sub">{failure.hint}</p>
          </div>
          {failure.detail ? (
            <pre className="start-detail">{failure.detail}</pre>
          ) : null}
          {/* Only template loading lands here now — import failures stay in
              the import view so the document can be corrected in place. */}
          <div className="start-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => setView({ kind: 'templates' })}
            >
              Back to templates
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setView({ kind: 'choose' })}
            >
              Back to start
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {picker}
      <div className="start-pane">
        {/* The same lockup the splash just settled into, at rest and small —
            the wordmark asset carries "Engine", which the brand lockup in
            `Logo` does not. */}
        <div className="start-head">
          <span className="start-logo">
            <img className="start-logo-mark" src={LOGO_MARK} alt="" />
            <img
              className="start-logo-word"
              src={SPLASH_WORDMARK}
              alt="Flarent Motion Engine"
            />
          </span>
          <h1 className="start-title">How do you want to start?</h1>
          <p className="start-sub">
            Choose a starting point for your next motion piece.
          </p>
        </div>

        <div className="start-cards">
          {CARDS.map((card, i) => (
            <button
              key={card.id}
              type="button"
              className="start-card"
              // The stagger is a custom property so the keyframes stay one rule.
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => {
                if (card.id === 'scratch') onOpen(createBlankProject(), 'scratch');
                else if (card.id === 'import') beginImport();
                else setView({ kind: 'templates' });
              }}
            >
              <span className="start-card-kicker">{card.kicker}</span>
              <span className="start-card-body">{card.body}</span>
              <span className="start-card-action">
                {card.action}
                <i className="start-arrow" aria-hidden>
                  →
                </i>
              </span>
            </button>
          ))}
        </div>

        {resumable ? (
          <p className="start-resume">
            <button
              type="button"
              className="linkish"
              onClick={() =>
                onOpen(createProjectFromPersisted(resumable), 'resumed')
              }
            >
              Resume last session
            </button>
            <span className="start-resume-note">
              {resumable.title ?? 'Untitled reel'} · {resumable.scenes.length} scenes
            </span>
          </p>
        ) : null}
      </div>
    </Shell>
  );
};
