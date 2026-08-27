import React, { useCallback, useRef, useState } from 'react';
import {
  parseFlarentScript,
  type ImportIssue,
  type ImportedProject,
} from '../../utils/importScript';

const IssueList: React.FC<{ issues: ImportIssue[] }> = ({ issues }) => {
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`} className={`issue is-${issue.severity}`}>
          {issue.path ? <code>{issue.path}</code> : null}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
};

export const ImportPanel: React.FC<{
  open: boolean;
  onClose: () => void;
  onApply: (project: ImportedProject) => void;
}> = ({ open, onClose, onApply }) => {
  const [text, setText] = useState('');
  const [issues, setIssues] = useState<ImportIssue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setIssues(null);
    setFailed(false);
  }, []);

  const run = useCallback(
    (source: string) => {
      const result = parseFlarentScript(source);
      setIssues(result.issues);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      onApply(result.project);
    },
    [onApply],
  );

  const readFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const source = String(reader.result ?? '');
        setText(source);
        run(source);
      };
      reader.onerror = () => {
        setFailed(true);
        setIssues([
          { path: file.name, message: 'Could not read the file.', severity: 'error' },
        ]);
      };
      reader.readAsText(file);
    },
    [run],
  );

  if (!open) return null;

  const errorCount = issues?.filter((i) => i.severity === 'error').length ?? 0;
  const warningCount = issues?.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Import script"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-head">
          <span>Import script</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          <button
            type="button"
            className={`dropzone${dragging ? ' is-over' : ''}`}
            onClick={() => inputRef.current?.click()}
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
            Drop a .json script, or click to choose a file
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json,.txt"
            hidden
            onChange={(event) => {
              readFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          <textarea
            className="text-input script-input"
            spellCheck={false}
            placeholder={'…or paste the JSON here'}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              reset();
            }}
          />

          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => run(text)}
              disabled={text.trim() === ''}
            >
              Import
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText('');
                reset();
              }}
              disabled={text.trim() === '' && issues === null}
            >
              Clear
            </button>
            {issues !== null ? (
              <span
                className={`sheet-status${failed ? ' is-error' : ''}`}
              >
                {failed
                  ? `Not imported — ${errorCount} ${errorCount === 1 ? 'problem' : 'problems'} found. Nothing changed.`
                  : `Imported${warningCount > 0 ? ` with ${warningCount} note${warningCount === 1 ? '' : 's'}` : ''}.`}
              </span>
            ) : null}
          </div>

          {issues !== null && issues.length > 0 ? (
            <>
              <p className="hint">
                {failed
                  ? 'Fix these and import again. The reel on screen is untouched.'
                  : 'Imported. These are the adjustments that were made:'}
              </p>
              <IssueList issues={issues} />
            </>
          ) : null}

          <details className="schema">
            <summary>Expected shape</summary>
            <pre>{`{
  "title": "7 Rules for Startups",
  "width": 1080, "height": 1920, "fps": 30,
  "backgroundPalette": { "green": "#12571C", "cream": "#EDEDED" },
  "scenes": [
    {
      "id": "scene-01",
      "duration": 0.65,              // seconds, required
      "text": "7 RULES",             // required
      "emphasis": ["7"],             // words or phrases
      "animation": "PUNCH",          // MASSIVE PUNCH STACK SLIDE RAPID
      "direction": "CENTER",         // LEFT RIGHT TOP BOTTOM CENTER
      "alignment": "CENTER",         // LEFT CENTER RIGHT
      "background": "GREEN",         // GREEN CREAM BLACK
      "visualNote": "Opening punch." // kept, never rendered
    }
  ]
}`}</pre>
            <p className="hint">
              A bare array of scenes works too. `start` is read for checking but
              the engine always derives timing from durations. Optional per
              scene: `case`, `scale`, `flipBackground`, and `image`
              (`src`, `placement`, `side`, `size`, `scrim`, `focusX`, `focusY`).
            </p>
          </details>
        </div>
      </div>
    </div>
  );
};
