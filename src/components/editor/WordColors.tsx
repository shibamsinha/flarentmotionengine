/**
 * Per-word colour.
 *
 * Modelled on the emphasis chips directly above it, because it answers the same
 * shape of question — "which word?" — and a user who has learned to click a
 * word to promote it should not have to learn a different gesture to colour
 * one. Click a word to select it, then pick a colour; click it again to clear.
 *
 * Colours are keyed by the *word*, not by its position, so re-typing the line
 * around a coloured word keeps the colour, and a word repeated in the line is
 * coloured everywhere it appears. That is the same trade `emphasis` makes, and
 * it is the right one: the author is colouring a word, not a slot.
 */

import React, { useState } from 'react';

/** Punctuation-stripped, lower-cased — the key the renderer looks up. */
export const colorKey = (word: string): string =>
  word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * A small on-brand starting point so the common cases are one click, with the
 * full RGB picker beside it for everything else. These are the engine's own
 * field and ink colours plus the accents V6 objects already use, so a coloured
 * word sits in the same palette as the rest of the reel by default.
 */
const SWATCHES = [
  '#4ADE6A', '#13581D', '#EEEEEE', '#0F0F0F',
  '#E5484D', '#F5A524', '#3E7BFA', '#B15CF0',
];

export const WordColors: React.FC<{
  /** The words of the line, in typed order. */
  words: string[];
  colors: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
}> = ({ words, colors, onChange }) => {
  const [selected, setSelected] = useState<string | null>(null);

  if (words.length === 0) return null;

  const set = (key: string, colour: string | null) => {
    const next = { ...(colors ?? {}) };
    if (colour === null) delete next[key];
    else next[key] = colour;
    // Undefined rather than an empty object, so a scene that has had all its
    // colours cleared serialises without the key at all.
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const activeColour = selected ? colors?.[selected] ?? '#4ADE6A' : '#4ADE6A';

  return (
    <div className="field">
      <label>Word colour · click a word, then pick</label>
      <div className="chips">
        {words.map((word, index) => {
          const key = colorKey(word);
          const colour = colors?.[key];
          return (
            <button
              key={`${word}-${index}`}
              type="button"
              className={`chip word-chip${selected === key ? ' is-on' : ''}`}
              onClick={() => setSelected(selected === key ? null : key)}
              title={colour ? `${word} — ${colour}` : `Colour "${word}"`}
            >
              {/* The swatch is the state: a word with no dot has no colour. */}
              {colour ? (
                <span className="word-chip-dot" style={{ background: colour }} />
              ) : null}
              {word}
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="word-color-picker">
          <div className="chips">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`word-swatch${colors?.[selected] === swatch ? ' is-on' : ''}`}
                style={{ background: swatch }}
                onClick={() => set(selected, swatch)}
                title={swatch}
              />
            ))}
          </div>
          <div className="colour-row">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(activeColour) ? activeColour : '#4ADE6A'}
              onChange={(e) => set(selected, e.target.value)}
            />
            <input
              className="text-input"
              value={colors?.[selected] ?? ''}
              placeholder="#4ADE6A or any CSS colour"
              spellCheck={false}
              onChange={(e) => set(selected, e.target.value || null)}
            />
            <button
              type="button"
              className="btn tiny"
              onClick={() => set(selected, null)}
              disabled={!colors?.[selected]}
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <p className="hint">
          {colors && Object.keys(colors).length > 0
            ? `Coloured: ${Object.keys(colors).join(', ')}`
            : 'Nothing coloured — every word takes the scene’s visual style.'}
        </p>
      )}
    </div>
  );
};
