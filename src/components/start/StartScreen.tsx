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

/**
 * A failure the user can act on. Raw parser messages are kept out of the
 * headline and offered underneath, because "Unexpected token < in JSON at
 * position 0" is not a sentence anyone should have to read to learn they picked
 * the wrong file.
 */
type Failure = { title: string; hint: string; detail: string | null };

type View =
  | { kind: 'choose' }
  | { kind: 'templates' }
  | { kind: 'busy'; label: string }
  | { kind: 'failed'; failure: Failure };

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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fail = useCallback((failure: Failure) => {
    setView({ kind: 'failed', failure });
  }, []);

  const readFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setView({ kind: 'busy', label: 'Importing project…' });

      const reader = new FileReader();
      reader.onerror = () =>
        fail({
          title: "That file couldn't be read.",
          hint: 'It may have been moved or renamed. Try choosing it again.',
          detail: null,
        });
      reader.onload = () => {
        const result = parseFlarentScript(String(reader.result ?? ''));
        if (!result.ok) {
          const errors = result.issues.filter((i) => i.severity === 'error');
          fail({
            title: "This isn't a valid Flarent Motion Engine project.",
            hint: 'Check that the file was extracted from the Motion Engine, then try another file.',
            detail:
              errors
                .slice(0, 4)
                .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
                .join('\n') || null,
          });
          return;
        }
        onOpen(createProjectFromJSON(result.project), 'import');
      };
      reader.readAsText(file);
    },
    [fail, onOpen],
  );

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
      <div className="start">
        {picker}
        <TemplateBrowser
          onUse={useTemplate}
          onBack={() => setView({ kind: 'choose' })}
        />
      </div>
    );
  }

  if (view.kind === 'busy') {
    return (
      <div className="start">
        {picker}
        <div className="start-pane is-busy">
          <p className="start-busy">{view.label}</p>
        </div>
      </div>
    );
  }

  if (view.kind === 'failed') {
    const { failure } = view;
    return (
      <div className="start">
        {picker}
        <div className="start-pane">
          <div className="start-head">
            <h1 className="start-title">{failure.title}</h1>
            <p className="start-sub">{failure.hint}</p>
          </div>
          {failure.detail ? (
            <pre className="start-detail">{failure.detail}</pre>
          ) : null}
          <div className="start-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => fileRef.current?.click()}
            >
              Try another file
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
      </div>
    );
  }

  return (
    <div className="start">
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
                else if (card.id === 'import') fileRef.current?.click();
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
    </div>
  );
};
