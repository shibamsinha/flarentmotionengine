/**
 * The extra controls inside a group, put away until asked for.
 *
 * `Group` answers "which of these seven subjects am I working on"; this answers
 * "how deep into this one subject do I want to go". They are different
 * questions and they want different weights — a group head is a heading, this
 * is a quiet line of text you can press.
 *
 * Phase 3 collected every advanced parameter into a single "Advanced" group at
 * the bottom of the panel. That was better than the flat list it replaced, but
 * it was still the wrong address: someone adjusting an entrance is *in* Motion,
 * and sending them to a different section to lengthen it breaks the thought
 * they were having. Locality beats tidiness here, which is why the Advanced
 * group is gone and its contents went back to the groups they belong to.
 *
 * State lives in the component for the same reason `Group`'s does — it is a
 * view preference, not part of the project — and survives a scene change for
 * the same reason: the instance keeps its place in the tree.
 */

import React, { useId, useState } from 'react';

export const Disclosure: React.FC<{
  /** What is behind it, named as a thing rather than as an instruction. */
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className={`disclosure${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="disclosure-chevron" aria-hidden>
          ▾
        </span>
        {label}
      </button>
      {open ? (
        <div className="disclosure-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
};
