/**
 * Controls for the selected object.
 *
 * The rule the brief sets is that only relevant controls appear: a circle has
 * no text controls, a button has no `shape` field. That is enforced structurally
 * here — the per-kind section is a switch on `object.type`, so an irrelevant
 * control cannot be rendered by accident.
 *
 * What is *not* here matters as much. There is no X/Y/scale/rotation/opacity
 * keyframe grid, no bezier handles, no graph editor. Motion is chosen by name
 * ("Pop In", "from the left", "fast") and the engine works out the curves —
 * `objectMotion.ts` holds the actual recipes. Position and size are set by
 * dragging on the canvas, which is what a canvas is for.
 *
 * Timing is in seconds because the brief is explicit that nobody should have to
 * think in frames, and because a user who does think in frames is a user the
 * abstraction has already failed.
 */

import React from 'react';
import type {
  ButtonObject,
  CardObject,
  CursorObject,
  GroupObject,
  IconName,
  IconObject,
  ImageObject,
  LogoObject,
  ObjectLabel,
  ObjectSurface,
  SceneObject,
  ShapeKind,
  ShapeObject,
} from '../../types/object';
import {
  ENTER, EMPHASIS, EXIT,
  type EnterMotion, type EmphasisMotion, type ExitMotion,
  type MotionDirection, type MotionSpeed, type MotionDistance,
} from '../../utils/objectMotion';
import { ICON_PATHS } from '../motion/objects/icons';
import { OBJECT_KIND_LABELS } from '../../data/objects';

type Patch = (patch: Partial<SceneObject>) => void;

/* ------------------------------------------------------------- primitives */

/* `<div class="field"><label>` is the shape the rest of the editor uses, and
   `.field > label` is what styles the caption — a <span> here would render the
   caption unstyled while looking correct in the JSX. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="field">
    <label>{label}</label>
    {children}
  </div>
);

function Pick<T extends string>({
  value, options, onChange, allowNone,
}: {
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (next: T | undefined) => void;
  allowNone?: string;
}) {
  return (
    <select
      className="text-input"
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
    >
      {allowNone ? <option value="">{allowNone}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

const Num: React.FC<{
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}> = ({ value, onChange, step = 0.01, min, max, placeholder }) => (
  <input
    className="text-input"
    type="number"
    step={step}
    min={min}
    max={max}
    placeholder={placeholder}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
  />
);

const Colour: React.FC<{ value: string | undefined; fallback: string; onChange: (v: string) => void }> = ({
  value, fallback, onChange,
}) => (
  <span className="colour-row">
    <input
      type="color"
      value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback}
      onChange={(e) => onChange(e.target.value)}
    />
    <input
      className="text-input"
      value={value ?? ''}
      placeholder={fallback}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  </span>
);

const opts = <T extends string>(values: readonly T[]): { value: T; label: string }[] =>
  values.map((v) => ({ value: v, label: v.replace(/-/g, ' ') }));

/* ------------------------------------------------------------------ label */

const LabelFields: React.FC<{
  title: string;
  label: ObjectLabel | undefined;
  onChange: (next: ObjectLabel | undefined) => void;
  fallbackColor: string;
}> = ({ title, label, onChange, fallbackColor }) => (
  <>
    <Row label={title}>
      <input
        className="text-input"
        value={label?.text ?? ''}
        placeholder="(none)"
        onChange={(e) =>
          onChange(e.target.value ? { ...label, text: e.target.value } : undefined)
        }
      />
    </Row>
    {label ? (
      <div className="field-row">
        <Row label="Size">
          <Num value={label.size} step={0.002} onChange={(size) => onChange({ ...label, size })} placeholder="0.028" />
        </Row>
        <Row label="Colour">
          <Colour value={label.color} fallback={fallbackColor} onChange={(color) => onChange({ ...label, color })} />
        </Row>
      </div>
    ) : null}
  </>
);

/* ---------------------------------------------------------------- surface */

const SurfaceFields: React.FC<{
  surface: ObjectSurface | undefined;
  onChange: (next: ObjectSurface) => void;
  fillFallback: string;
}> = ({ surface, onChange, fillFallback }) => {
  const set = (patch: Partial<ObjectSurface>) => onChange({ ...surface, ...patch });
  return (
    <>
      <Row label="Fill">
        <Colour value={surface?.fill} fallback={fillFallback} onChange={(fill) => set({ fill })} />
      </Row>
      <div className="field-row">
        <Row label="Corner radius">
          <Num value={surface?.radius} step={0.02} min={0} max={0.5} onChange={(radius) => set({ radius })} placeholder="0" />
        </Row>
        <Row label="Shadow">
          <Pick
            value={surface?.shadow}
            options={opts(['none', 'soft', 'medium', 'strong'] as const)}
            onChange={(shadow) => set({ shadow })}
            allowNone="none"
          />
        </Row>
      </div>
      <div className="field-row">
        <Row label="Glow">
          <Pick
            value={surface?.glow}
            options={opts(['none', 'low', 'medium', 'high'] as const)}
            onChange={(glow) => set({ glow })}
            allowNone="none"
          />
        </Row>
        <Row label="Glow colour">
          <Colour value={surface?.glowColor} fallback="#4ade6a" onChange={(glowColor) => set({ glowColor })} />
        </Row>
      </div>
    </>
  );
};

/* ----------------------------------------------------------------- motion */

const MotionFields: React.FC<{ object: SceneObject; patch: Patch }> = ({ object, patch }) => {
  const motion = object.motion ?? {};
  const set = (p: Partial<typeof motion>) => patch({ motion: { ...motion, ...p } } as Partial<SceneObject>);

  const enterRecipe = motion.enter && motion.enter !== 'none' ? ENTER[motion.enter] : null;
  const exitRecipe = motion.exit && motion.exit !== 'none' ? EXIT[motion.exit] : null;
  const directional = Boolean(enterRecipe?.directional || exitRecipe?.directional);

  return (
    <>
      <div className="section-head">Motion</div>
      <div className="controls">
        <Row label="Enter">
          <Pick
            value={motion.enter}
            options={(Object.keys(ENTER) as Exclude<EnterMotion, 'none'>[]).map((k) => ({
              value: k, label: ENTER[k].label,
            }))}
            onChange={(enter) => set({ enter })}
            allowNone="None"
          />
        </Row>
        {enterRecipe ? <p className="hint">{enterRecipe.description}</p> : null}

        <div className="field-row">
          <Row label="Speed">
            <Pick
              value={motion.speed}
              options={opts(['slow', 'medium', 'fast'] as const)}
              onChange={(speed) => set({ speed: speed as MotionSpeed })}
              allowNone="medium"
            />
          </Row>
          <Row label="Distance">
            <Pick
              value={motion.distance}
              options={opts(['small', 'medium', 'large'] as const)}
              onChange={(distance) => set({ distance: distance as MotionDistance })}
              allowNone="medium"
            />
          </Row>
        </div>

        {/* Direction is only offered when the chosen preset actually travels —
            asking "from which edge?" about a fade is a question with no answer. */}
        {directional ? (
          <Row label="From">
            <Pick
              value={motion.from}
              options={opts(['left', 'right', 'top', 'bottom'] as const)}
              onChange={(from) => set({ from: from as MotionDirection })}
              allowNone="bottom"
            />
          </Row>
        ) : null}

        <Row label="While on screen">
          <Pick
            value={motion.emphasis}
            options={(Object.keys(EMPHASIS) as Exclude<EmphasisMotion, 'none'>[]).map((k) => ({
              value: k, label: EMPHASIS[k].label,
            }))}
            onChange={(emphasis) => set({ emphasis })}
            allowNone="Nothing"
          />
        </Row>

        <Row label="Exit">
          <Pick
            value={motion.exit}
            options={(Object.keys(EXIT) as Exclude<ExitMotion, 'none'>[]).map((k) => ({
              value: k, label: EXIT[k].label,
            }))}
            onChange={(exit) => set({ exit })}
            allowNone="None"
          />
        </Row>

        <div className="field-row">
          <Row label="Delay (s)">
            <Num value={motion.delay} step={0.05} min={0} onChange={(delay) => set({ delay })} placeholder="0" />
          </Row>
          <Row label="Start (s)">
            <Num value={object.start} step={0.05} min={0} onChange={(start) => patch({ start })} placeholder="0" />
          </Row>
          <Row label="Duration (s)">
            <Num value={object.duration} step={0.1} min={0} onChange={(duration) => patch({ duration })} placeholder="rest of scene" />
          </Row>
        </div>
      </div>
    </>
  );
};

/* ------------------------------------------------------------- inspector */

export const ObjectInspector: React.FC<{
  object: SceneObject | null;
  ink: string;
  onChange: (patch: Partial<SceneObject>) => void;
  /** Every id in the scene, so a cursor can be pointed at one. */
  targets: { id: string; label: string }[];
}> = ({ object, ink, onChange, targets }) => {
  if (!object) {
    return (
      <div className="section">
        <div className="section-head">Object</div>
        <p className="hint" style={{ padding: '8px' }}>
          Select an object to edit it, or drag it on the canvas.
        </p>
      </div>
    );
  }

  const patch: Patch = onChange;

  return (
    <div className="section">
      <div className="section-head">
        {OBJECT_KIND_LABELS[object.type]}
        <span className="spacer" />
      </div>

      <div className="controls">
        {/* ------------------------------------------------ per-kind content */}
        {object.type === 'shape' ? (
          <>
            <Row label="Shape">
              <Pick
                value={(object as ShapeObject).shape}
                options={opts(['rectangle', 'rounded', 'circle', 'line'] as const)}
                onChange={(shape) => patch({ shape: shape as ShapeKind } as Partial<SceneObject>)}
              />
            </Row>
            <SurfaceFields
              surface={(object as ShapeObject).surface}
              fillFallback={ink}
              onChange={(surface) => patch({ surface } as Partial<SceneObject>)}
            />
          </>
        ) : null}

        {object.type === 'icon' ? (
          <>
            <Row label="Icon">
              <Pick
                value={(object as IconObject).icon}
                options={(Object.keys(ICON_PATHS) as IconName[]).map((k) => ({ value: k, label: k }))}
                onChange={(icon) => patch({ icon: icon as IconName } as Partial<SceneObject>)}
              />
            </Row>
            <div className="field-row">
              <Row label="Colour">
                <Colour
                  value={(object as IconObject).color}
                  fallback={ink}
                  onChange={(color) => patch({ color } as Partial<SceneObject>)}
                />
              </Row>
              <Row label="Stroke">
                <Num
                  value={(object as IconObject).weight}
                  step={0.2} min={0.5}
                  onChange={(weight) => patch({ weight } as Partial<SceneObject>)}
                  placeholder="2"
                />
              </Row>
            </div>
          </>
        ) : null}

        {object.type === 'image' || object.type === 'logo' ? (
          <>
            <Row label="Source">
              <input
                className="text-input"
                value={(object as ImageObject | LogoObject).src}
                placeholder="uploads/… or https://…"
                spellCheck={false}
                onChange={(e) => patch({ src: e.target.value } as Partial<SceneObject>)}
              />
            </Row>
            <Row label="Fit">
              <Pick
                value={(object as ImageObject).fit}
                options={opts(['contain', 'cover'] as const)}
                onChange={(fit) => patch({ fit } as Partial<SceneObject>)}
                allowNone="contain"
              />
            </Row>
          </>
        ) : null}

        {object.type === 'card' ? (
          <>
            <LabelFields
              title="Title"
              label={(object as CardObject).title}
              fallbackColor={ink}
              onChange={(title) => patch({ title } as Partial<SceneObject>)}
            />
            <LabelFields
              title="Body"
              label={(object as CardObject).body}
              fallbackColor={ink}
              onChange={(body) => patch({ body } as Partial<SceneObject>)}
            />
            <SurfaceFields
              surface={(object as CardObject).surface}
              fillFallback="#16181b"
              onChange={(surface) => patch({ surface } as Partial<SceneObject>)}
            />
          </>
        ) : null}

        {object.type === 'button' ? (
          <>
            <LabelFields
              title="Label"
              label={(object as ButtonObject).label}
              fallbackColor="#0c0d0c"
              onChange={(label) => patch({ label } as Partial<SceneObject>)}
            />
            <Row label="Icon">
              <Pick
                value={(object as ButtonObject).icon}
                options={(Object.keys(ICON_PATHS) as IconName[]).map((k) => ({ value: k, label: k }))}
                onChange={(icon) => patch({ icon } as Partial<SceneObject>)}
                allowNone="None"
              />
            </Row>
            <SurfaceFields
              surface={(object as ButtonObject).surface}
              fillFallback="#f2f4f2"
              onChange={(surface) => patch({ surface } as Partial<SceneObject>)}
            />
            <p className="hint">
              A cursor click can put this button into its success state — add a
              cursor and point one of its stops at this object.
            </p>
          </>
        ) : null}

        {object.type === 'cursor' ? (
          <CursorFields object={object as CursorObject} patch={patch} targets={targets} />
        ) : null}

        {object.type === 'group' ? (
          <>
            <Row label="Children animate">
              <Pick
                value={(object as GroupObject).sequence}
                options={[
                  { value: 'together' as const, label: 'All together' },
                  { value: 'after' as const, label: 'One after another' },
                  { value: 'stagger' as const, label: 'Stagger' },
                ]}
                onChange={(sequence) => patch({ sequence } as Partial<SceneObject>)}
                allowNone="All together"
              />
            </Row>
            <Row label="Stagger (s)">
              <Num
                value={(object as GroupObject).stagger}
                step={0.02} min={0}
                onChange={(stagger) => patch({ stagger } as Partial<SceneObject>)}
                placeholder="0.12"
              />
            </Row>
          </>
        ) : null}

        {/* -------------------------------------------------- shared: place */}
        <div className="section-head" style={{ marginTop: 6 }}>Position</div>
        <div className="field-row">
          <Row label="X"><Num value={object.x} onChange={(x) => patch({ x: x ?? 0 })} /></Row>
          <Row label="Y"><Num value={object.y} onChange={(y) => patch({ y: y ?? 0 })} /></Row>
        </div>
        <div className="field-row">
          <Row label="Width"><Num value={object.width} onChange={(width) => patch({ width: width ?? 0.1 })} /></Row>
          <Row label="Height"><Num value={object.height} onChange={(height) => patch({ height: height ?? 0.1 })} /></Row>
        </div>
        <div className="field-row">
          <Row label="Rotation (°)">
            <Num value={object.rotation} step={1} onChange={(rotation) => patch({ rotation })} placeholder="0" />
          </Row>
          <Row label="Opacity">
            <Num value={object.opacity} step={0.05} min={0} max={1} onChange={(opacity) => patch({ opacity })} placeholder="1" />
          </Row>
        </div>
        {/* Alignment, as one click each. Non-designers should not have to do
            arithmetic to centre something. */}
        <div className="chips">
          <button type="button" className="btn tiny"
            onClick={() => patch({ x: (1 - object.width) / 2 })}>Centre X</button>
          <button type="button" className="btn tiny"
            onClick={() => patch({ y: (1 - object.height) / 2 })}>Centre Y</button>
          <button type="button" className="btn tiny" onClick={() => patch({ x: 0.08 })}>Left</button>
          <button type="button" className="btn tiny"
            onClick={() => patch({ x: 1 - 0.08 - object.width })}>Right</button>
          <button type="button" className="btn tiny" onClick={() => patch({ y: 0.08 })}>Top</button>
          <button type="button" className="btn tiny"
            onClick={() => patch({ y: 1 - 0.08 - object.height })}>Bottom</button>
        </div>
      </div>

      {object.type !== 'cursor' ? <MotionFields object={object} patch={patch} /> : null}
    </div>
  );
};

/**
 * A cursor is edited as a list of stops, not as a motion preset — its whole
 * behaviour *is* where it goes and what it does on arrival.
 */
const CursorFields: React.FC<{
  object: CursorObject;
  patch: Patch;
  targets: { id: string; label: string }[];
}> = ({ object, patch, targets }) => {
  const setStop = (i: number, next: Partial<CursorObject['stops'][number]>) =>
    patch({
      stops: object.stops.map((s, j) => (j === i ? { ...s, ...next } : s)),
    } as Partial<SceneObject>);

  return (
    <>
      <p className="hint">
        The pointer travels between stops. A stop with an action can put another
        object into a new state — that is how a click drives a button.
      </p>
      {object.stops.map((stop, i) => (
        <div key={i} className="cursor-stop">
          <div className="section-head">Stop {i + 1}</div>
          <div className="field-row">
            <Row label="X"><Num value={stop.x} onChange={(x) => setStop(i, { x: x ?? 0.5 })} /></Row>
            <Row label="Y"><Num value={stop.y} onChange={(y) => setStop(i, { y: y ?? 0.5 })} /></Row>
            <Row label="At (s)"><Num value={stop.at} step={0.1} onChange={(at) => setStop(i, { at: at ?? 0 })} /></Row>
          </div>
          <div className="field-row">
            <Row label="Travel (s)">
              <Num value={stop.travel} step={0.1} onChange={(travel) => setStop(i, { travel })} placeholder="0.6" />
            </Row>
            <Row label="Path">
              <Pick value={stop.path} options={opts(['straight', 'arc', 'curve'] as const)}
                    onChange={(path) => setStop(i, { path })} allowNone="straight" />
            </Row>
            <Row label="Action">
              <Pick value={stop.action} options={opts(['none', 'click', 'press', 'hover'] as const)}
                    onChange={(action) => setStop(i, { action })} allowNone="none" />
            </Row>
          </div>
          {stop.action && stop.action !== 'none' ? (
            <div className="field-row">
              <Row label="Acts on">
                <Pick
                  value={stop.targetId}
                  options={targets.filter((t) => t.id !== object.id).map((t) => ({ value: t.id, label: t.label }))}
                  onChange={(targetId) => setStop(i, { targetId })}
                  allowNone="Nothing"
                />
              </Row>
              <Row label="Puts it in">
                <Pick
                  value={stop.targetState}
                  options={opts(['default', 'hover', 'pressed', 'active', 'success', 'error'] as const)}
                  onChange={(targetState) => setStop(i, { targetState })}
                  allowNone="—"
                />
              </Row>
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="btn wide"
        onClick={() => {
          const last = object.stops[object.stops.length - 1];
          patch({
            stops: [
              ...object.stops,
              { x: 0.5, y: 0.5, at: (last?.at ?? 0) + 1, travel: 0.6, path: 'arc' },
            ],
          } as Partial<SceneObject>);
        }}
      >
        + Add stop
      </button>
    </>
  );
};
