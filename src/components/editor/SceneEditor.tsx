import React from 'react';
import type {
  Alignment,
  AnimationStyle,
  BackgroundName,
  PaletteName,
  Scene,
  SlideDirection,
  TextCase,
} from '../../types/scene';
import { ImageControls } from './ImageControls';
import { ElementEditor, seedElements } from './ElementEditor';
import { VisualStyleControls } from './VisualStyleControls';
import { ANIMATION_STYLES, styleDefinition } from '../motion/registry';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION } from '../../utils/timing';
import {
  fieldsOf,
  isEmphasised,
  paletteFor,
  splitWords,
} from '../../utils/typography';

type Option<T extends string> = { value: T; label: string };

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const STYLE_OPTIONS: Option<AnimationStyle>[] = ANIMATION_STYLES.map((id) => ({
  value: id,
  label: styleDefinition(id).label,
}));

const round2 = (n: number): number => Math.round(n * 100) / 100;

const clampDuration = (n: number): number =>
  Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, round2(n)));

const FIELD_LABEL: Record<BackgroundName, string> = {
  green: 'Green',
  cream: 'Cream',
  black: 'Black',
};

export const SceneEditor: React.FC<{
  scene: Scene | null;
  palette: PaletteName;
  /** Whether the project has a static overlay to opt out of. */
  hasOverlay: boolean;
  onChange: (patch: Partial<Scene>) => void;
}> = ({ scene, palette, hasOverlay, onChange }) => {
  if (!scene) {
    return (
      <div className="section">
        <div className="section-head">Scene</div>
        <p className="hint" style={{ padding: '0 16px 18px' }}>
          Select a scene to edit it.
        </p>
      </div>
    );
  }

  const definition = styleDefinition(scene.style);
  const words = splitWords(scene.text.replace(/\n/g, ' '));
  const emphasis = scene.emphasis ?? [];
  const composed = (scene.elements?.length ?? 0) > 0;

  const toggleEmphasis = (word: string) => {
    const next = isEmphasised(word, emphasis)
      ? emphasis.filter(
          (candidate) => candidate.toLowerCase() !== word.toLowerCase(),
        )
      : [...emphasis, word];
    onChange({ emphasis: next });
  };

  const nudge = (delta: number) =>
    onChange({ duration: clampDuration(scene.duration + delta) });

  return (
    <div className="section">
      <div className="section-head">Scene</div>

      <div className="controls">
        {scene.note ? (
          <p className="scene-note" title="From the imported script's visualNote">
            {scene.note}
          </p>
        ) : null}

        {composed ? (
          <ElementEditor scene={scene} palette={palette} onChange={onChange} />
        ) : (
          <>
            <div className="field">
              <label htmlFor="scene-text">Text</label>
              <textarea
                id="scene-text"
                className="text-input"
                value={scene.text}
                spellCheck={false}
                onChange={(event) => onChange({ text: event.target.value })}
              />
              <p className="hint">
                Line breaks are honoured as line breaks. On one line,
                un-emphasised words become the small supporting line — kept in
                the order you typed them, so support before the hero sits above
                it and support after sits below.
              </p>
            </div>

            {words.length > 0 ? (
              <div className="field">
                <label>Emphasis · click to promote a word</label>
                <div className="chips">
                  {words.map((word, index) => (
                    <button
                      key={`${word}-${index}`}
                      type="button"
                      className={`chip${isEmphasised(word, emphasis) ? ' is-on' : ''}`}
                      onClick={() => toggleEmphasis(word)}
                    >
                      {word}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  {emphasis.length === 0
                    ? 'Nothing marked — the last word carries the scene.'
                    : `Hero: ${emphasis.join(', ')}`}
                </p>
              </div>
            ) : null}

            <div className="field">
              <button
                type="button"
                className="btn wide"
                onClick={() => onChange({ elements: seedElements(scene) })}
              >
                Compose · split into elements
              </button>
              <p className="hint">
                Gives each phrase its own role, size, position and animation.
                Starts from the layout this scene already has, so nothing moves
                until you move it.
              </p>
            </div>
          </>
        )}

        <div className="field">
          <label>{composed ? 'Animation · scene default' : 'Animation'}</label>
          <Segmented
            value={scene.style}
            options={STYLE_OPTIONS}
            onChange={(style) => onChange({ style })}
          />
          <p className="hint">
            {composed
              ? `${definition.description} Elements left on AUTO use this.`
              : definition.description}
          </p>
        </div>

        <VisualStyleControls
          scope="scene"
          style={scene.visualStyle}
          config={scene.styleConfig}
          background={scene.background}
          palette={palette}
          onChange={(visualStyle, styleConfig) =>
            onChange({ visualStyle, styleConfig })
          }
        />

        <div className="field">
          <label>Duration · seconds</label>
          <div className="number-row">
            <button type="button" className="stepper" onClick={() => nudge(-0.05)}>
              −
            </button>
            <input
              type="number"
              step="0.05"
              min={MIN_SCENE_DURATION}
              max={MAX_SCENE_DURATION}
              value={scene.duration}
              onChange={(event) =>
                onChange({ duration: clampDuration(Number(event.target.value)) })
              }
            />
            <button type="button" className="stepper" onClick={() => nudge(0.05)}>
              +
            </button>
            <input
              type="range"
              min={MIN_SCENE_DURATION}
              max={4}
              step={0.05}
              value={Math.min(scene.duration, 4)}
              onChange={(event) =>
                onChange({ duration: clampDuration(Number(event.target.value)) })
              }
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Field</label>
            <Segmented<BackgroundName>
              value={
                fieldsOf(palette).includes(scene.background)
                  ? scene.background
                  : paletteFor(palette).dark
              }
              options={fieldsOf(palette).map((name) => ({
                value: name,
                label: FIELD_LABEL[name],
              }))}
              onChange={(background) => onChange({ background })}
            />
          </div>
          <div className="field">
            <label>Alignment</label>
            <Segmented<Alignment>
              value={scene.alignment}
              options={[
                { value: 'left', label: 'L' },
                { value: 'center', label: 'C' },
                { value: 'right', label: 'R' },
              ]}
              onChange={(alignment) => onChange({ alignment })}
            />
          </div>
        </div>

        <div className="field">
          <label>Type scale · {(scene.fontSize ?? 1).toFixed(2)}×</label>
          <div className="number-row">
            <input
              type="range"
              min={0.35}
              max={1.8}
              step={0.01}
              value={scene.fontSize ?? 1}
              onChange={(event) =>
                onChange({ fontSize: Number(event.target.value) })
              }
            />
            <button
              type="button"
              className="btn"
              onClick={() => onChange({ fontSize: 1 })}
            >
              Reset
            </button>
          </div>
        </div>

        {definition.supports.direction ? (
          <div className="field">
            <label>Enter from</label>
            <Segmented<SlideDirection>
              value={scene.direction ?? 'bottom'}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(direction) => onChange({ direction })}
            />
          </div>
        ) : null}

        <div className="field-row">
          <div className="field">
            <label>Case</label>
            <Segmented<TextCase>
              value={scene.case ?? 'lower'}
              options={[
                { value: 'lower', label: 'lower' },
                { value: 'upper', label: 'UPPER' },
                { value: 'as-typed', label: 'Typed' },
              ]}
              onChange={(nextCase) => onChange({ case: nextCase })}
            />
          </div>
        </div>

        {definition.supports.flipBackground ? (
          <div className="field">
            <label>Field cut</label>
            <Segmented
              value={scene.flipBackground ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'Hold' },
                { value: 'on', label: 'Flip each beat' },
              ]}
              onChange={(value) => onChange({ flipBackground: value === 'on' })}
            />
            <p className="hint">
              Cuts the background on every reveal — the reference's signature
              move in its fast section.
            </p>
          </div>
        ) : null}

        {hasOverlay ? (
          <div className="field">
            <label>Static image</label>
            <Segmented
              value={scene.hideOverlay ? 'off' : 'on'}
              options={[
                { value: 'on', label: 'Show' },
                { value: 'off', label: 'Hide here' },
              ]}
              onChange={(value) =>
                onChange({ hideOverlay: value === 'off' ? true : undefined })
              }
            />
            <p className="hint">
              The reel's static image is on by default. Drop it for this scene
              when it would land on the type.
            </p>
          </div>
        ) : null}

        <ImageControls scene={scene} onChange={onChange} />
      </div>
    </div>
  );
};
