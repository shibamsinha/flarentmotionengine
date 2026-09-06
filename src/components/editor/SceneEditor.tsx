/**
 * The scene inspector.
 *
 * This file used to be one `.section` containing twenty control groups in the
 * order they were written, which is not an order — a beginner's first scene
 * showed "Background strobe · every N frames" between Duration and Alignment,
 * and the only thing telling you that "Text" mattered more than "Strobe · flip
 * count" was that it happened to be higher up.
 *
 * It is now six named groups, and the grouping is the whole point:
 *
 *   Text      what the scene says
 *   Look      how it is set
 *   Position  where it sits
 *   Motion    how it arrives and leaves
 *   Timing    how long it lasts
 *   Image     the picture, if it has one
 *
 * Each group keeps its rare parameters behind a `Disclosure` rather than in a
 * shared "Advanced" section at the bottom: someone lengthening an entrance is
 * already in Motion, and sending them elsewhere to finish the thought is the
 * tidier arrangement and the worse one.
 *
 * **Nothing was removed and no patch changed.** Every `onChange` in here sends
 * the identical `Partial<Scene>` it sent before; the engine, the serialiser and
 * the MCP layer cannot tell this file was rewritten. That is the invariant to
 * review this against — if a control moved groups, its payload did not.
 */

import React from 'react';
import type {
  Alignment,
  AnimationStyle,
  BackgroundName,
  PaletteName,
  Scene,
  SlideDirection,
  TextCase,
  VideoConfig,
} from '../../types/scene';
import { ImageControls } from './ImageControls';
import { CompositionField, ElementEditor, seedElements } from './ElementEditor';
import { VisualStyleControls } from './VisualStyleControls';
import { WordColors } from './WordColors';
import { Group } from './Group';
import { Disclosure } from './Disclosure';
import { ANIMATION_STYLES, styleDefinition } from '../motion/registry';
import { ENTER_SECONDS } from '../motion/primitives';
import type { FieldOverrides, FontRole } from '../../utils/typography';
import { CANVAS, MAX_SCENE_DURATION, MIN_SCENE_DURATION } from '../../utils/timing';
import {
  FONT_ROLES,
  FONT_STACK,
  faceFor,
  faceStyles,
  fieldsOf,
  isEmphasised,
  paletteFor,
  splitWords,
  themeFor,
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

/**
 * A choice you make by looking rather than by reading.
 *
 * "Sans / Serif" and "Lower / Upper / As typed" are accurate and tell you
 * nothing — the whole question is what the type will look like, and the answer
 * fits in two characters. The samples are drawn in the engine's own faces
 * (`FACES`, the same map the renderer resolves through), so what is in the
 * button is what will export.
 */
function SampleSegmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: (Option<T> & { sample: string; style?: React.CSSProperties })[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="sample-row">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`sample-card${option.value === value ? ' is-on' : ''}`}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          <span className="sample-glyph" style={option.style} aria-hidden>
            {option.sample}
          </span>
          <span className="sample-name">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Three lines, weighted to the chosen edge. Alignment is a shape, not a word. */
const AlignGlyph: React.FC<{ align: Alignment }> = ({ align }) => (
  <span className={`align-glyph is-${align}`} aria-hidden>
    <i />
    <i />
    <i />
  </span>
);

const round2 = (n: number): number => Math.round(n * 100) / 100;

const clampDuration = (n: number): number =>
  Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, round2(n)));

/**
 * The seconds a frame count comes to, for showing beside it.
 *
 * Editors think in both and should never have to convert. Frames are the unit
 * you set — they are what the engine is exact in — and this is the answer to
 * "how long is that?", shown rather than asked for.
 */
const frameSeconds = (f: number): string => `${(f / CANVAS.fps).toFixed(2)}s`;

const FIELD_LABEL: Record<BackgroundName, string> = {
  green: 'Green',
  cream: 'Cream',
  black: 'Black',
};

export const SceneEditor: React.FC<{
  scene: Scene | null;
  palette: PaletteName;
  /**
   * The project's colour overrides. Needed only so the previews in here can
   * show the colours this reel will actually paint rather than the house ones —
   * a swatch that lies is worse than no swatch.
   */
  fields: FieldOverrides;
  ink: FieldOverrides;
  accent: string | null;
  /** Whether the project has a static overlay to opt out of. */
  hasOverlay: boolean;
  onChange: (patch: Partial<Scene>) => void;
  /** Offered by the empty state, so "no scenes" has a way out of itself. */
  onAddScene: () => void;
  /** The project's frame. Portrait unless the project chose landscape. */
  canvas?: VideoConfig;
}> = ({ scene, palette, fields, ink, accent, hasOverlay, onChange, onAddScene, canvas }) => {
  /* No scene: say what this panel is for and offer the one thing that fills
     it, rather than instructing the reader to go and click somewhere else. */
  if (!scene) {
    return (
      <div className="section">
        <div className="section-head">Scene</div>
        <div className="empty-state">
          <p className="empty-state-text">
            Pick a scene from the reel on the left to edit its text, look,
            motion and timing.
          </p>
          <button type="button" className="btn" onClick={onAddScene}>
            Add a scene
          </button>
        </div>
      </div>
    );
  }

  const definition = styleDefinition(scene.style);
  const words = splitWords(scene.text.replace(/\n/g, ' '));
  const emphasis = scene.emphasis ?? [];
  const composed = (scene.elements?.length ?? 0) > 0;
  const frames = Math.max(1, Math.round(scene.duration * CANVAS.fps));

  /*
   * The treatment swatches preview the scene's *own* words. Choosing between
   * four ways of painting "CUSTOMERS" is a configuration exercise; choosing
   * between four ways of painting the word you just typed is a creative one.
   * Falls back to the house sample for an empty scene, and to a short word when
   * the line is long, because the swatch is only ~92px wide.
   */
  const sampleWord =
    words.slice().sort((a, b) => a.length - b.length).find((w) => w.length >= 3) ??
    words[0];

  /** How long this style takes to arrive, straight from the engine's own map. */
  const enterFrames = Math.round(ENTER_SECONDS[scene.style] * CANVAS.fps);
  const staggerFrames = scene.stagger?.delayFrames ?? 0;

  const toggleEmphasis = (word: string) => {
    const next = isEmphasised(word, emphasis)
      ? emphasis.filter(
          (candidate) => candidate.toLowerCase() !== word.toLowerCase(),
        )
      : [...emphasis, word];
    onChange({ emphasis: next });
  };

  /**
   * Set the duration by frame count. Seconds remain what is stored — the
   * timing model is untouched — but frames are what is typed, so the rounding
   * happens once, here, instead of on every read.
   */
  const setFrames = (next: number) =>
    onChange({
      duration: clampDuration(
        Math.max(1, Math.min(Math.round(MAX_SCENE_DURATION * CANVAS.fps), next)) /
          CANVAS.fps,
      ),
    });

  return (
    <>
      {/* ---------------------------------------------------------- text */}
      <Group
        title="Text"
        summary={
          composed
            ? `${scene.elements?.length} element${scene.elements?.length === 1 ? '' : 's'}`
            : undefined
        }
      >
        {scene.note ? (
          <p className="scene-note" title="From the imported script's visualNote">
            {scene.note}
          </p>
        ) : null}

        {composed ? (
          <ElementEditor
            scene={scene}
            palette={palette}
            onChange={onChange}
            canvas={canvas}
          />
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
                <label>Emphasis</label>
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
                    ? 'Click a word to promote it. Nothing marked — the last word carries the scene.'
                    : `Hero: ${emphasis.join(', ')}`}
                </p>
              </div>
            ) : null}

            {/* Directly under emphasis: same question ("which word?"), same
                gesture, so the two read as one group. */}
            <WordColors
              words={words}
              colors={scene.wordColors}
              onChange={(wordColors) => onChange({ wordColors })}
            />

            <div className="field">
              <button
                type="button"
                className="btn wide"
                onClick={() =>
                  onChange({
                    elements: seedElements(
                      scene,
                      // Without a canvas the split falls back to the plain
                      // grammar rather than guessing at a frame size.
                      canvas ? { palette, canvas } : undefined,
                    ),
                  })
                }
              >
                Split into elements
              </button>
              <p className="hint">
                Gives each phrase its own role, size, position and animation.
                Starts from the layout this scene already has, so nothing moves
                until you move it.
              </p>
            </div>
          </>
        )}
      </Group>

      {/* ---------------------------------------------------------- look */}
      <Group title="Look">
        {/* Two two-option segments side by side. Case has three and gets its
            own row — paired with these it wrapped, and a wrapped segment reads
            as an emphasised option rather than as an overflowing one. */}
        <div className="field">
          <label>Typeface</label>
          <SampleSegmented<FontRole>
            value={scene.fontRole ?? 'primary'}
            options={FONT_ROLES.map((role) => {
              const face = faceFor(role);
              return {
                value: role,
                label: role === 'primary' ? 'Sans' : 'Serif',
                sample: 'Ag',
                style: { fontFamily: face.family, ...faceStyles(face) },
              };
            })}
            onChange={(role) => onChange({ fontRole: role === 'primary' ? undefined : role })}
          />
        </div>

        <div className="field">
          <label>Case</label>
          <SampleSegmented<TextCase>
            value={scene.case ?? 'lower'}
            options={(
              [
                { value: 'lower', label: 'Lower', sample: 'ag' },
                { value: 'upper', label: 'Upper', sample: 'AG' },
                { value: 'as-typed', label: 'As typed', sample: 'Ag' },
              ] as { value: TextCase; label: string; sample: string }[]
            ).map((option) => ({
              ...option,
              style: { fontFamily: FONT_STACK, fontWeight: 800 },
            }))}
            onChange={(nextCase) => onChange({ case: nextCase })}
          />
        </div>

        <div className="field">
          <label>Background</label>
          {/* The swatch is the choice. A field named "Green" that is not the
              green you are about to get is a name standing in for the thing. */}
          <div className="sample-row">
            {fieldsOf(palette).map((name) => {
              const theme = themeFor(name, palette, fields, ink, accent ?? undefined);
              const active =
                (fieldsOf(palette).includes(scene.background)
                  ? scene.background
                  : paletteFor(palette).dark) === name;
              return (
                <button
                  key={name}
                  type="button"
                  className={`sample-card${active ? ' is-on' : ''}`}
                  onClick={() => onChange({ background: name })}
                  title={`${FIELD_LABEL[name]} field`}
                >
                  <span
                    className="sample-glyph"
                    style={{
                      background: theme.background,
                      color: theme.ink,
                      fontFamily: FONT_STACK,
                      fontWeight: 800,
                    }}
                    aria-hidden
                  >
                    Ag
                  </span>
                  <span className="sample-name">{FIELD_LABEL[name]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label>Size · {(scene.fontSize ?? 1).toFixed(2)}×</label>
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
          <p className="hint">
            Multiplies whatever size the scene's role and layout already chose.
          </p>
        </div>

        <VisualStyleControls
          scope="scene"
          style={scene.visualStyle}
          config={scene.styleConfig}
          background={scene.background}
          palette={palette}
          fields={fields}
          ink={ink}
          accent={accent}
          sample={sampleWord}
          onChange={(visualStyle, styleConfig) =>
            onChange({ visualStyle, styleConfig })
          }
        />

        {/* A constraint on the size chosen above, so it belongs with size —
            but you reach for it once in twenty scenes. */}
        <Disclosure label="More type">
          <div className="field">
            <label>Max width</label>
            <input
              type="number"
              step={1}
              min={5}
              max={100}
              placeholder="Size preset"
              value={scene.fit ? Math.round(scene.fit.maxWidth * 100) : ''}
              onChange={(event) => {
                const raw = event.target.value.trim();
                // Blank returns the scene to its size preset, bleed and all.
                if (raw === '') return onChange({ fit: undefined });
                const percent = Math.min(100, Math.max(5, Math.round(Number(raw) || 88)));
                onChange({ fit: { mode: 'width', maxWidth: percent / 100 } });
              }}
            />
            <p className="hint">
              A percentage of the frame. Blank lets the size preset bleed past
              the edge as it was measured to.
            </p>
          </div>
        </Disclosure>
      </Group>

      {/* ------------------------------------------------------ position */}
      <Group title="Position">
        <div className="field">
          <label>Alignment</label>
          <div className="sample-row">
            {(['left', 'center', 'right'] as Alignment[]).map((align) => (
              <button
                key={align}
                type="button"
                className={`sample-card${scene.alignment === align ? ' is-on' : ''}`}
                onClick={() => onChange({ alignment: align })}
                title={align === 'center' ? 'Centre' : align === 'left' ? 'Left' : 'Right'}
              >
                <span className="sample-glyph is-plain">
                  <AlignGlyph align={align} />
                </span>
                <span className="sample-name">
                  {align === 'center' ? 'Centre' : align === 'left' ? 'Left' : 'Right'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Only composed scenes have an arrangement to choose; a single block
            has nowhere to be arranged. */}
        {composed ? <CompositionField scene={scene} onChange={onChange} /> : null}

        <p className="hint">
          Drag the type on the canvas to place it exactly.
        </p>
      </Group>

      {/* -------------------------------------------------------- motion */}
      <Group title="Motion" summary={definition.label}>
        <div className="field">
          <label>{composed ? 'Entrance · scene default' : 'Entrance'}</label>
          <Segmented
            value={scene.style}
            options={STYLE_OPTIONS}
            onChange={(style) => onChange({ style })}
          />
          {/*
            The house length for this entrance, read from `ENTER_SECONDS` — the
            same constant the style components and the delay-chaining use, so
            this cannot drift from what the engine does. NONE is a real hard cut
            in the engine (the `Static` component), not a UI fiction, and says so.
          */}
          <p className="hint">
            {composed
              ? `${definition.description} Elements left on Auto use this.`
              : definition.description}{' '}
            {enterFrames > 0
              ? `Takes about ${enterFrames} frame${enterFrames === 1 ? '' : 's'} to arrive.`
              : 'Cuts in with no entrance at all.'}
          </p>
        </div>

        <div className="field">
          <label>Exit</label>
          <select
            className="text-input"
            value={scene.exit ?? ''}
            onChange={(event) =>
              onChange({
                exit: event.target.value === ''
                  ? undefined
                  : (event.target.value as AnimationStyle),
              })
            }
          >
            {/* Blank is not "no exit" — it is "leave the way you arrived",
                which is what every scene did before this control existed.
                None is the explicit no-exit. */}
            <option value="">Same as the entrance</option>
            {ANIMATION_STYLES.map((id) => (
              <option key={id} value={id}>
                {styleDefinition(id).label}
              </option>
            ))}
          </select>
          <p className="hint">
            {scene.exit
              ? styleDefinition(scene.exit).description
              : `Leaves the way it arrived — ${definition.label.toLowerCase()}, reversed.`}
          </p>
        </div>

        {/*
          Word timing as a decision, not a number.

          It was a bare frame count with "Together" as its placeholder, so the
          two things it can express — every word at once, or one after another —
          were an empty field and a non-empty one. They are different creative
          choices and now look like it; the frame count only appears once you
          have asked for the second, which is the only time it means anything.
        */}
        <div className="field">
          <label>Word timing</label>
          <Segmented<'together' | 'stagger'>
            value={staggerFrames > 0 ? 'stagger' : 'together'}
            options={[
              { value: 'together', label: 'All together' },
              { value: 'stagger', label: 'One word at a time' },
            ]}
            onChange={(mode) =>
              onChange({
                stagger:
                  mode === 'together'
                    ? undefined
                    : {
                        type: 'word',
                        delayFrames: staggerFrames > 0 ? staggerFrames : 2,
                        ...(scene.stagger?.order ? { order: scene.stagger.order } : {}),
                      },
              })
            }
          />
          {staggerFrames > 0 ? (
            <>
              <div className="number-row">
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={60}
                  value={staggerFrames}
                  onChange={(event) => {
                    const delayFrames = Math.max(1, Math.round(Number(event.target.value) || 1));
                    onChange({
                      stagger: {
                        type: 'word',
                        delayFrames,
                        ...(scene.stagger?.order ? { order: scene.stagger.order } : {}),
                      },
                    });
                  }}
                />
                <span className="unit-note">
                  frames apart · {frameSeconds(staggerFrames)}
                </span>
              </div>
              <p className="hint">
                Each word lands {staggerFrames} frame{staggerFrames === 1 ? '' : 's'} after
                the one before it.
              </p>
            </>
          ) : (
            <p className="hint">Every word arrives in the same frame.</p>
          )}
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

        {/*
          Everything below is a refinement of the four choices above. Someone
          adjusting an entrance is already here — sending them to a separate
          "Advanced" section at the bottom of the panel to lengthen it would
          break the thought they were having.
        */}
        <Disclosure label="More motion">
          <div className="field-row">
            <div className="field">
              <label>Entrance length</label>
              <input
                type="number"
                step={1}
                min={1}
                max={120}
                placeholder="Style default"
                value={scene.enterFrames ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  // Empty means "use the style's own measured entrance", which
                  // is a different thing from "one frame" and must stay
                  // expressible.
                  onChange({
                    enterFrames: raw === '' ? undefined : Math.max(1, Math.round(Number(raw) || 1)),
                  });
                }}
              />
            </div>
            <div className="field">
              <label>Exit length</label>
              <input
                type="number"
                step={1}
                min={0}
                max={120}
                placeholder="Style default"
                value={scene.exitFrames ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onChange({
                    exitFrames: raw === '' ? undefined : Math.max(0, Math.round(Number(raw) || 0)),
                  });
                }}
              />
            </div>
          </div>
          <p className="hint">
            Both in frames. Blank uses the style's own measured length —{' '}
            {enterFrames > 0
              ? `${enterFrames} frames (${frameSeconds(enterFrames)}) for ${definition.label}.`
              : `${definition.label} has no entrance to shorten.`}
            {scene.enterFrames
              ? ` Currently ${scene.enterFrames}f · ${frameSeconds(scene.enterFrames)}.`
              : ''}
            {scene.exitFrames
              ? ` Exit ${scene.exitFrames}f · ${frameSeconds(scene.exitFrames)}.`
              : ''}
          </p>

          <div className="field">
            <label>Reveal order</label>
            <Segmented<'forward' | 'reverse'>
              value={scene.stagger?.order ?? 'forward'}
              options={[
                { value: 'forward', label: 'Forward' },
                { value: 'reverse', label: 'Reverse' },
              ]}
              onChange={(order) =>
                onChange({
                  stagger: {
                    type: 'word',
                    delayFrames: scene.stagger?.delayFrames ?? 2,
                    ...(order === 'reverse' ? { order } : {}),
                  },
                })
              }
            />
            <p className="hint">Which end of the line starts first.</p>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Background flicker</label>
              <input
                type="number"
                step={1}
                min={1}
                max={120}
                placeholder="Off"
                value={scene.backgroundMotion?.everyFrames ?? ''}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === '') return onChange({ backgroundMotion: undefined });
                  const everyFrames = Math.max(1, Math.round(Number(raw) || 1));
                  onChange({
                    backgroundMotion: {
                      mode: 'alternate',
                      everyFrames,
                      ...(scene.backgroundMotion?.times !== undefined
                        ? { times: scene.backgroundMotion.times }
                        : {}),
                    },
                  });
                }}
              />
            </div>
            <div className="field">
              <label>Flicker count</label>
              <input
                type="number"
                step={1}
                min={0}
                max={200}
                placeholder="Whole scene"
                disabled={!scene.backgroundMotion}
                value={scene.backgroundMotion?.times ?? ''}
                onChange={(event) => {
                  if (!scene.backgroundMotion) return;
                  const raw = event.target.value.trim();
                  onChange({
                    backgroundMotion: {
                      ...scene.backgroundMotion,
                      ...(raw === '' ? {} : { times: Math.max(0, Math.round(Number(raw) || 0)) }),
                    },
                  });
                }}
              />
            </div>
          </div>
          <p className="hint">
            Cuts the field back and forth every N frames — the reference's hard
            strobe. Leave the count blank to run it for the whole scene.
          </p>

          {definition.supports.flipBackground ? (
            <div className="field">
              <label>Flip background on each reveal</label>
              <Segmented
                value={scene.flipBackground ? 'on' : 'off'}
                options={[
                  { value: 'off', label: 'Hold' },
                  { value: 'on', label: 'Flip' },
                ]}
                onChange={(value) => onChange({ flipBackground: value === 'on' })}
              />
              <p className="hint">
                Cuts the background on every reveal — the reference's signature
                move in its fast section.
              </p>
            </div>
          ) : null}
        </Disclosure>
      </Group>

      {/* -------------------------------------------------------- timing */}
      <Group title="Timing" summary={`${frames}f · ${frameSeconds(frames)}`}>
        {/*
          One control, not two.

          There were two: "Duration · seconds & frames" (a seconds field with a
          stepper and a slider) and "Frames · exact" (a frame field), adjacent,
          editing the same number. Two controls for one value is not a
          convenience — it is a question about which one is authoritative, asked
          on every scene.

          Frames win, because frames are what the engine is exact in and what an
          editor cuts on. The stored value is still `duration` in seconds and
          still goes through `clampDuration`, so the timing model has not moved;
          seconds are shown beside the field as the derived thing they are.
        */}
        <div className="field">
          <label>Duration</label>
          <div className="number-row">
            <button
              type="button"
              className="stepper"
              onClick={() => setFrames(frames - 1)}
              title="One frame shorter"
            >
              −
            </button>
            <input
              type="number"
              step={1}
              min={1}
              max={Math.round(MAX_SCENE_DURATION * CANVAS.fps)}
              value={frames}
              onChange={(event) => setFrames(Math.round(Number(event.target.value) || 1))}
            />
            <button
              type="button"
              className="stepper"
              onClick={() => setFrames(frames + 1)}
              title="One frame longer"
            >
              +
            </button>
            <span className="unit-note">
              frames · <b>{frameSeconds(frames)}</b>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={4 * CANVAS.fps}
            step={1}
            value={Math.min(frames, 4 * CANVAS.fps)}
            onChange={(event) => setFrames(Math.round(Number(event.target.value)))}
          />
          <p className="hint">
            At {CANVAS.fps}fps. Drag past the end of the slider by typing — a
            scene can run to {MAX_SCENE_DURATION}s.
          </p>
        </div>
      </Group>

      {/* --------------------------------------------------------- image */}
      <Group title="Image" summary={scene.image ? 'on' : undefined} defaultOpen={Boolean(scene.image)}>
        <ImageControls scene={scene} onChange={onChange} canvas={canvas} />

        {hasOverlay ? (
          <div className="field">
            <label>The reel's static image</label>
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
              On by default. Drop it for this scene when it would land on the
              type.
            </p>
          </div>
        ) : null}
      </Group>

    </>
  );
};
