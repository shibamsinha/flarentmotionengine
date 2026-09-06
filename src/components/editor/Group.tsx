/**
 * A named, collapsible group of controls.
 *
 * The inspector's problem was never the number of controls — it was that all of
 * them sat at one level, so "what does this scene say" and "how many frames
 * apart do its words appear" were presented as equally urgent questions. A
 * group is the smallest thing that fixes that: it gives a run of controls a
 * name, and it gives the reader permission to skip it.
 *
 * Deliberately not `<details>`. The native element is the right semantics but
 * its marker is close to unstylable across browsers and its open state cannot
 * be driven from React without fighting it, so this is a button with the ARIA
 * that `<details>` would have given us anyway.
 *
 * Open state lives here, in the component, not in the project. It is a view
 * preference — it has no business in the auto-save or the extracted JSON — and
 * because a `Group` keeps its position in the tree when the selected scene
 * changes, React keeps that state across scene switches, which is what you want:
 * a user who opened Advanced once should not have to open it again for the next
 * scene.
 */

import React, { useId, useState } from 'react';

export const Group: React.FC<{
  title: string;
  /**
   * A word or two shown after the title — a count, a current value, whatever
   * makes the group worth opening. It is what a collapsed group has instead of
   * its contents, so prefer something that changes over something decorative.
   */
  summary?: React.ReactNode;
  /** Closed groups are the exception, not the rule; say so explicitly. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, summary, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`section group${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="section-head group-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        {title}
        <span className="spacer" />
        {summary !== undefined && summary !== null ? <span>{summary}</span> : null}
        <span className="group-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="controls" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
};
