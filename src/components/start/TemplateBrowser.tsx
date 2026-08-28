/**
 * Reference Reels, as a way into the editor.
 *
 * The templates are `PRESETS` from `data/presets.ts` — the same list the
 * editor's preset dropdown has always loaded, read here rather than copied.
 * There is deliberately no second template data structure, no template
 * registry, and no per-template preview asset: a preset is a `build()` that
 * returns scenes, and everything on screen is derived from those scenes.
 *
 * The poster is drawn from the reel's own fields rather than from a rendered
 * thumbnail. `themeFor()` is the function the renderer itself uses to resolve a
 * scene's background and ink, so a poster cannot drift from what the template
 * actually looks like — and fourteen live Remotion players on a chooser would
 * be slow for no gain. Hovering steps through the opening scenes on a pure CSS
 * cycle, which reads as motion without mounting anything.
 *
 * Selection is a two-step on purpose (pick, then "Use this template"): a single
 * click straight into the editor makes a mis-click cost the user their place,
 * and the brief asks for a preview state before committing.
 */

import React, { useMemo, useState } from 'react';
import { PRESETS, type Preset } from '../../data/presets';
import type { Scene } from '../../types/scene';
import { DEFAULT_PALETTE, themeFor } from '../../utils/typography';
import { formatSeconds, totalFrames, CANVAS } from '../../utils/timing';

/** How many opening scenes the filmstrip shows. */
const POSTER_SCENES = 5;

const firstLine = (text: string): string => {
  const line = text.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  return line || '—';
};

/**
 * A preset's `note` opens with its own scene count and sometimes its duration
 * ("9 scenes · 14.4s · style rhythm"), which would be printed twice here
 * because the card derives both from the scenes themselves. Rather than edit
 * fourteen presets — that string is also what the editor's dropdown shows — the
 * counted parts are dropped and only the description is kept. A note that is
 * nothing but a count leaves an empty string and the line is hidden.
 */
const description = (note: string): string =>
  note
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^\d+\s*scenes?$/i.test(part) && !/^[\d.]+\s*s$/i.test(part))
    .join(' · ');

/**
 * The poster is a filmstrip of the opening scenes at the reel's real aspect.
 *
 * A single still would say almost nothing about a reel — these are films, and
 * what distinguishes one template from another at a glance is its *rhythm*: how
 * often the field cuts between green and cream, and how the type sits. Five
 * frames side by side show that in the same visual language the editor's
 * Timeline already uses. It is also static, so a fourteen-card grid costs
 * nothing to paint.
 */
const Poster: React.FC<{ scenes: Scene[] }> = ({ scenes }) => (
  <span className="tpl-poster" aria-hidden>
    {scenes.slice(0, POSTER_SCENES).map((scene) => {
      const theme = themeFor(scene.background, DEFAULT_PALETTE);
      return (
        <span
          key={scene.id}
          className="tpl-frame"
          style={{ background: theme.background, color: theme.ink }}
        >
          <span className="tpl-frame-text">{firstLine(scene.text)}</span>
        </span>
      );
    })}
  </span>
);

const TemplateCard: React.FC<{
  preset: Preset;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
}> = ({ preset, selected, onSelect, onUse }) => {
  const scenes = useMemo(() => preset.build(), [preset]);
  const seconds = totalFrames(scenes, CANVAS.fps) / CANVAS.fps;
  const note = description(preset.note);

  return (
    <div className={`tpl-card${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="tpl-pick"
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onUse}
      >
        <Poster scenes={scenes} />
        <span className="tpl-meta">
          <span className="tpl-name">{preset.label}</span>
          {note ? <span className="tpl-note">{note}</span> : null}
        </span>
        <span className="tpl-stats">
          {scenes.length} scenes · {formatSeconds(seconds)}
        </span>
      </button>
      {/* Only the selected card offers the commit, so there is exactly one
          "go" on screen at a time. */}
      {selected ? (
        <button type="button" className="btn primary tpl-use" onClick={onUse}>
          Use this template
        </button>
      ) : null}
    </div>
  );
};

export const TemplateBrowser: React.FC<{
  onUse: (preset: Preset) => void;
  onBack: () => void;
}> = ({ onUse, onBack }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="start-pane is-browser">
      <div className="start-head">
        <button type="button" className="start-back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="start-title">Reference Reels</h1>
        <p className="start-sub">
          Pick one as a starting point. It opens as your own editable copy — the
          original is never changed.
        </p>
      </div>

      <div className="tpl-grid">
        {PRESETS.map((preset) => (
          <TemplateCard
            key={preset.id}
            preset={preset}
            selected={preset.id === selectedId}
            onSelect={() => setSelectedId(preset.id)}
            onUse={() => onUse(preset)}
          />
        ))}
      </div>
    </div>
  );
};
