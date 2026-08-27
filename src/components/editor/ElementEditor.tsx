/**
 * V3 element controls.
 *
 * Deliberately plain: four dropdowns and a text box per element. The brief asks
 * for the minimum needed to drive a composition, not a timeline editor, and the
 * engine already refuses to need one — every field here is semantic, so there is
 * nothing to drag and no pixel to nudge.
 */

import React from 'react';
import type {
  AnimationStyle,
  CompositionPreset,
  PaletteName,
  PositionPreset,
  Scene,
  SceneElement,
  SizePreset,
  TextRole,
} from '../../types/scene';
import { blankElement, element as makeElement } from '../../data/defaultScenes';
import { ANIMATION_STYLES, styleDefinition } from '../motion/registry';
import {
  COMPOSITIONS,
  COMPOSITION_PRESETS,
  POSITION_LABEL,
  POSITION_PRESETS,
  ROLE_LABEL,
  ROLE_SIZE,
  SIZE_LABEL,
  SIZE_PRESETS,
  TEXT_ROLES,
} from '../../utils/composition';
import { isEmphasised, splitLines, splitWords } from '../../utils/typography';
import { VisualStyleControls } from './VisualStyleControls';

/**
 * Turn a V2 text scene into elements without changing what it looks like.
 *
 * Follows the same grammar the single-block planner uses — the emphasised run
 * is the hero, what reads before it is a lead-in, what reads after is a
 * qualifier — so switching a scene to elements is a change of *control*, not a
 * change of design. Landing on a different layout would make the button feel
 * like it broke something.
 */
export const seedElements = (scene: Scene): SceneElement[] => {
  const lines = splitLines(scene.text);
  if (lines.length === 0) return [blankElement()];

  const emphasis = scene.emphasis ?? [];
  const marked = lines.map((line) =>
    splitWords(line).some((word) => isEmphasised(word, emphasis)),
  );

  if (lines.length > 1) {
    const heroIndex = marked.indexOf(true) >= 0 ? marked.indexOf(true) : lines.length - 1;
    return lines.map((line, index) =>
      makeElement(line, {
        role:
          index === heroIndex ? 'primary' : index < heroIndex ? 'secondary' : 'support',
        animation: scene.style,
      }),
    );
  }

  // One line: split it into the emphasised run and what surrounds it.
  const words = splitWords(lines[0]);
  const flags =
    emphasis.length > 0
      ? words.map((word) => isEmphasised(word, emphasis))
      : words.map((_, index) => index === words.length - 1);

  const runs: { hero: boolean; words: string[] }[] = [];
  words.forEach((word, index) => {
    const hero = flags[index];
    const current = runs[runs.length - 1];
    if (current && current.hero === hero) current.words.push(word);
    else runs.push({ hero, words: [word] });
  });

  const heroIndex = runs.findIndex((run) => run.hero);
  return runs.map((run, index) =>
    makeElement(run.words.join(' '), {
      role: run.hero ? 'primary' : index < heroIndex ? 'secondary' : 'support',
      animation: scene.style,
    }),
  );
};

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (next: T | '') => void;
  /** Shown for the empty value — what the element inherits when unset. */
  placeholder?: string;
}) {
  return (
    <label className="mini-field">
      <span>{label}</span>
      <select
        className="mini-select"
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const ROLE_OPTIONS = TEXT_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }));
const SIZE_OPTIONS = SIZE_PRESETS.map((size) => ({ value: size, label: SIZE_LABEL[size] }));
const POSITION_OPTIONS = POSITION_PRESETS.map((position) => ({
  value: position,
  label: POSITION_LABEL(position),
}));
const STYLE_OPTIONS = ANIMATION_STYLES.map((id) => ({
  value: id,
  label: styleDefinition(id).label,
}));

export const ElementEditor: React.FC<{
  scene: Scene;
  palette: PaletteName;
  onChange: (patch: Partial<Scene>) => void;
}> = ({ scene, palette, onChange }) => {
  const elements = scene.elements ?? [];

  /**
   * `text` is kept in step with the elements even though it is not what
   * renders. It is what the scene list shows and what the export filename is
   * built from, and letting it drift leaves the editor labelling scenes with
   * words that are no longer in them.
   */
  const commit = (next: SceneElement[]) =>
    onChange({
      elements: next,
      text: next.map((entry) => entry.text).join('\n'),
    });

  const patch = (index: number, changes: Partial<SceneElement>) =>
    commit(
      elements.map((entry, i) => (i === index ? { ...entry, ...changes } : entry)),
    );

  /** Dropping a field means "inherit again", so it is deleted, not blanked. */
  const clear = (index: number, key: keyof SceneElement) =>
    commit(
      elements.map((entry, i) => {
        if (i !== index) return entry;
        const copy = { ...entry };
        delete copy[key];
        return copy;
      }),
    );

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= elements.length) return;
    const next = [...elements];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const composition = scene.composition ?? '';

  return (
    <>
      <div className="field">
        <label htmlFor="scene-composition">Composition</label>
        <select
          id="scene-composition"
          className="mini-select"
          value={composition}
          onChange={(event) =>
            event.target.value
              ? onChange({ composition: event.target.value as CompositionPreset })
              : onChange({ composition: undefined })
          }
        >
          <option value="">AUTO — chosen from the elements</option>
          {COMPOSITION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {COMPOSITIONS[preset].label}
            </option>
          ))}
        </select>
        <p className="hint">
          {composition
            ? COMPOSITIONS[composition as CompositionPreset].description
            : 'One element centres; two stack left; three split. Elements that name their own position are placed there regardless.'}
        </p>
      </div>

      <div className="field">
        <label>
          Elements · {elements.length}
        </label>
        <div className="elements">
          {elements.map((entry, index) => (
            <div className="element-card" key={entry.id}>
              <div className="element-head">
                <span className="element-index">{index + 1}</span>
                <input
                  className="element-text"
                  value={entry.text}
                  spellCheck={false}
                  onChange={(event) => patch(index, { text: event.target.value })}
                />
                <button
                  type="button"
                  className="btn icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn icon"
                  title="Move down"
                  disabled={index === elements.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn icon"
                  title="Remove this element"
                  onClick={() => commit(elements.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>

              <div className="element-grid">
                <Select
                  label="Role"
                  value={entry.role ?? 'primary'}
                  options={ROLE_OPTIONS}
                  onChange={(role) => patch(index, { role: role as TextRole })}
                />
                <Select
                  label="Size"
                  value={entry.size ?? ''}
                  placeholder={`AUTO · ${SIZE_LABEL[ROLE_SIZE[entry.role ?? 'primary']]}`}
                  options={SIZE_OPTIONS}
                  onChange={(size) =>
                    size ? patch(index, { size: size as SizePreset }) : clear(index, 'size')
                  }
                />
                <Select
                  label="Position"
                  value={entry.position ?? ''}
                  placeholder="AUTO · from composition"
                  options={POSITION_OPTIONS}
                  onChange={(position) =>
                    position
                      ? patch(index, { position: position as PositionPreset })
                      : clear(index, 'position')
                  }
                />
                <Select
                  label="Animation"
                  value={entry.animation ?? ''}
                  placeholder={`AUTO · ${styleDefinition(scene.style).label}`}
                  options={STYLE_OPTIONS}
                  onChange={(animation) =>
                    animation
                      ? patch(index, { animation: animation as AnimationStyle })
                      : clear(index, 'animation')
                  }
                />
              </div>

              <VisualStyleControls
                scope="element"
                style={entry.visualStyle}
                config={entry.styleConfig}
                background={scene.background}
                palette={palette}
                inherited={scene.visualStyle ?? 'solid'}
                onChange={(visualStyle, styleConfig) =>
                  commit(
                    elements.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            ...(visualStyle
                              ? { visualStyle, styleConfig }
                              : { visualStyle: undefined, styleConfig: undefined }),
                          }
                        : item,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>

        <div className="element-actions">
          <button
            type="button"
            className="btn"
            onClick={() => commit([...elements, blankElement()])}
          >
            Add element
          </button>
          <button
            type="button"
            className="btn"
            title="Go back to one block of text with emphasis"
            onClick={() => onChange({ elements: undefined, composition: undefined })}
          >
            Single text
          </button>
        </div>
        <p className="hint">
          AUTO on any field means the element inherits — size from its role,
          position from the composition, animation from the scene.
        </p>
      </div>
    </>
  );
};
