/**
 * V8 — the project's colours.
 *
 * The two preset palettes (Green · Cream, Black · Cream) stay exactly where they
 * were in the top bar; this is the panel for going off them. It is deliberately
 * project-level rather than per-scene, because that is what a palette *is*: a
 * scene keeps saying which *field* it sits on and the project decides what that
 * field looks like. Colours scattered across fifty scenes are not a palette,
 * they are fifty decisions.
 *
 * Two columns per field, and the distinction between them is the whole idea:
 *
 *   **Field** — the ground. Override it and the engine still derives a readable
 *   ink automatically, which is the safety net that keeps an imported script
 *   legible when it drops in a mid-tone.
 *
 *   **Ink** — the type. Set it and it is honoured exactly, with no contrast
 *   substitution. Auto-contrast is a net for a value nobody chose; silently
 *   overriding a colour someone *did* choose would make the control useless.
 *
 * Each row shows what the engine will actually paint, including the derived ink,
 * so the effect of leaving a cell blank is visible rather than something to
 * guess at.
 */

import React from 'react';
import type { BackgroundName, PaletteName } from '../../types/scene';
import { Group } from './Group';
import {
  DEFAULT_ACCENT,
  FIELDS,
  type FieldOverrides,
  themeFor,
} from '../../utils/typography';

const FIELD_NAMES: BackgroundName[] = ['green', 'cream', 'black'];

const FIELD_LABEL: Record<BackgroundName, string> = {
  green: 'Green',
  cream: 'Cream',
  black: 'Black',
};

/** A hex swatch plus a text box, with a Reset that clears rather than guesses. */
const ColorCell: React.FC<{
  value: string | undefined;
  fallback: string;
  onChange: (value: string | undefined) => void;
  title: string;
}> = ({ value, fallback, onChange, title }) => (
  <div className="palette-cell">
    <input
      type="color"
      className="palette-swatch"
      aria-label={title}
      title={title}
      value={value ?? fallback}
      onChange={(event) => onChange(event.target.value.toUpperCase())}
    />
    <input
      type="text"
      className="palette-hex"
      spellCheck={false}
      placeholder={fallback}
      value={value ?? ''}
      onChange={(event) => {
        const raw = event.target.value.trim();
        // Blank clears the override. Anything that is not a full hex is left in
        // the box but not committed, so typing "#1A0" mid-edit does not repaint
        // the reel with a colour nobody asked for.
        if (raw === '') return onChange(undefined);
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) onChange(raw.toUpperCase());
      }}
    />
  </div>
);

export const PaletteControls: React.FC<{
  palette: PaletteName;
  fields: FieldOverrides;
  ink: FieldOverrides;
  accent: string | null;
  onFields: (next: FieldOverrides) => void;
  onInk: (next: FieldOverrides) => void;
  onAccent: (next: string | null) => void;
}> = ({ palette, fields, ink, accent, onFields, onInk, onAccent }) => {
  const patch = (map: FieldOverrides, name: BackgroundName, value: string | undefined) => {
    const next = { ...map };
    if (value === undefined) delete next[name];
    else next[name] = value;
    return next;
  };

  const overridden =
    Object.keys(fields).length + Object.keys(ink).length + (accent ? 1 : 0);

  return (
    <Group
      title="Palette"
      summary={overridden > 0 ? `${overridden} custom` : 'House'}
      defaultOpen={overridden > 0}
    >
      <p className="hint">
        Field is the ground; ink is the type. Leave ink blank and Flarent derives
        a readable colour for you — set it and it is used exactly.
      </p>

      <div className="palette-grid">
        <div className="palette-grid-head">
          <span />
          <span>Field</span>
          <span>Ink</span>
          <span>Preview</span>
        </div>

        {FIELD_NAMES.map((name) => {
          // Exactly what the renderer will resolve, derived ink included.
          const theme = themeFor(name, palette, fields, ink, accent ?? DEFAULT_ACCENT);
          return (
            <div className="palette-grid-row" key={name}>
              <span className="palette-field-name">{FIELD_LABEL[name]}</span>
              <ColorCell
                value={fields[name]}
                fallback={FIELDS[name]}
                title={`${FIELD_LABEL[name]} field colour`}
                onChange={(value) => onFields(patch(fields, name, value))}
              />
              <ColorCell
                value={ink[name]}
                fallback={theme.ink}
                title={`Type colour on ${FIELD_LABEL[name]}`}
                onChange={(value) => onInk(patch(ink, name, value))}
              />
              <span
                className="palette-preview"
                style={{ background: theme.background, color: theme.ink }}
              >
                Aa
              </span>
            </div>
          );
        })}
      </div>

      <div className="field">
        <label>Accent · used by graphic objects</label>
        <ColorCell
          value={accent ?? undefined}
          fallback={DEFAULT_ACCENT}
          title="Project accent colour"
          onChange={(value) => onAccent(value ?? null)}
        />
      </div>

      {overridden > 0 ? (
        <button
          type="button"
          className="btn wide"
          onClick={() => {
            onFields({});
            onInk({});
            onAccent(null);
          }}
        >
          Reset to the house palette
        </button>
      ) : null}
    </Group>
  );
};
