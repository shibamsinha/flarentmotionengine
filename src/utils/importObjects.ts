/**
 * V6 — objects across the JSON boundary.
 *
 * Kept in its own file rather than folded into `importScript.ts`, which is
 * already 1200 lines of typography vocabulary. The two share `ImportIssue` and
 * the same all-or-nothing contract; nothing else about parsing a rounded
 * rectangle resembles parsing a composition preset.
 *
 * The rules match the existing importer's, because a document should not
 * behave differently depending on which half of it is being read:
 *
 *  - **Unknown enum values are errors, never silent substitutions.** A typo in
 *    an animation name has to be reported, or an AI-generated script will
 *    quietly render something nobody asked for.
 *  - **Validation is total before anything is applied.** A half-imported scene
 *    is worse than a rejected one.
 *  - **Serialise is the exact inverse of parse.** Defaults are omitted on the
 *    way out, so a document only ever grows keys it actually needs, and the
 *    round trip settles.
 *
 * Names are shouted in JSON (`POP_IN`, `SLIDE_IN`) to match the existing
 * schema's `MASSIVE`/`TOP_LEFT` convention, and read back case-insensitively
 * with both hyphen and underscore accepted.
 */

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
  ObjectState,
  ObjectSurface,
  SceneObject,
  ShapeKind,
  ShapeObject,
  StateChange,
  StateTransition,
  CursorStop,
} from '../types/object';
import type {
  EnterMotion,
  EmphasisMotion,
  ExitMotion,
  MotionDirection,
  MotionDistance,
  MotionSpeed,
} from './objectMotion';
import { ENTER, EMPHASIS, EXIT } from './objectMotion';
import { ICON_PATHS } from '../components/motion/objects/icons';

export type ObjectIssue = { path: string; message: string; severity: 'error' | 'warning' };

/** `POP_IN` / `pop-in` / `Pop In` all read as `pop-in`. */
const slug = (value: string): string =>
  value.trim().toLowerCase().replace(/[_\s]+/g, '-');

/** The inverse, for writing. `pop-in` → `POP_IN`. */
export const shoutObject = (value: string): string =>
  value.replace(/-/g, '_').toUpperCase();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const OBJECT_KINDS = [
  'shape', 'image', 'icon', 'card', 'button', 'logo', 'cursor', 'group',
] as const;
const SHAPES: ShapeKind[] = ['rectangle', 'rounded', 'circle', 'line'];
const STATES: ObjectState[] = ['default', 'hover', 'pressed', 'active', 'success', 'error'];
const TRANSITIONS: StateTransition[] = ['instant', 'smooth', 'spring', 'morph', 'fade'];
const DIRECTIONS: MotionDirection[] = ['left', 'right', 'top', 'bottom'];
const SPEEDS: MotionSpeed[] = ['slow', 'medium', 'fast'];
const DISTANCES: MotionDistance[] = ['small', 'medium', 'large'];
const SEQUENCES = ['together', 'after', 'stagger'] as const;
const FITS = ['cover', 'contain'] as const;
const SHADOWS = ['none', 'soft', 'medium', 'strong'] as const;
const GLOWS = ['none', 'low', 'medium', 'high'] as const;
const ENTERS = ['none', ...Object.keys(ENTER)] as EnterMotion[];
const EMPHASES = ['none', ...Object.keys(EMPHASIS)] as EmphasisMotion[];
const EXITS = ['none', ...Object.keys(EXIT)] as ExitMotion[];
const ICONS = Object.keys(ICON_PATHS) as IconName[];

export const parseObjects = (
  raw: unknown,
  path: string,
  issues: ObjectIssue[],
  makeId: () => string,
): SceneObject[] | null => {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    issues.push({ path, message: 'Expected an array of objects.', severity: 'error' });
    return null;
  }

  const fail = (p: string, message: string) =>
    issues.push({ path: p, message, severity: 'error' });

  /** Enum reader. An unrecognised value is an error, never a fallback. */
  const oneOf = <T extends string>(
    value: unknown, allowed: readonly T[], p: string, label: string,
  ): T | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      fail(p, `Expected a ${label} name.`);
      return undefined;
    }
    const found = allowed.find((a) => a === slug(value));
    if (!found) {
      fail(p, `"${value}" is not a ${label}. Expected one of: ${allowed.join(', ')}.`);
      return undefined;
    }
    return found;
  };

  const num = (value: unknown, p: string, fallback?: number): number | undefined => {
    if (value === undefined || value === null) return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      fail(p, 'Expected a number.');
      return fallback;
    }
    return n;
  };

  const label = (value: unknown, p: string): ObjectLabel | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return { text: value };
    if (!isRecord(value)) { fail(p, 'Expected text, or an object with `text`.'); return undefined; }
    const text = value.text;
    if (typeof text !== 'string') { fail(`${p}.text`, 'Missing. A label needs `text`.'); return undefined; }
    return {
      text,
      color: typeof value.color === 'string' ? value.color : undefined,
      size: num(value.size, `${p}.size`),
      weight: num(value.weight, `${p}.weight`),
      align: oneOf(value.align, ['left', 'center', 'right'] as const, `${p}.align`, 'alignment'),
      tracking: num(value.tracking, `${p}.tracking`),
    };
  };

  const surface = (value: unknown, p: string): ObjectSurface | undefined => {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) { fail(p, 'Expected a style object.'); return undefined; }
    return {
      fill: typeof value.fill === 'string' ? value.fill : undefined,
      stroke: typeof value.stroke === 'string' ? value.stroke : undefined,
      strokeWidth: num(value.strokeWidth, `${p}.strokeWidth`),
      radius: num(value.radius, `${p}.radius`),
      shadow: oneOf(value.shadow, SHADOWS, `${p}.shadow`, 'shadow'),
      glow: oneOf(value.glow, GLOWS, `${p}.glow`, 'glow'),
      glowColor: typeof value.glowColor === 'string' ? value.glowColor : undefined,
      blur: num(value.blur, `${p}.blur`),
    };
  };

  const motion = (value: unknown, p: string) => {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) { fail(p, 'Expected a motion object.'); return undefined; }
    return {
      enter: oneOf(value.enter, ENTERS, `${p}.enter`, 'entrance'),
      from: oneOf(value.from, DIRECTIONS, `${p}.from`, 'direction'),
      speed: oneOf(value.speed, SPEEDS, `${p}.speed`, 'speed'),
      distance: oneOf(value.distance, DISTANCES, `${p}.distance`, 'distance'),
      emphasis: oneOf(value.emphasis, EMPHASES, `${p}.emphasis`, 'emphasis'),
      exit: oneOf(value.exit, EXITS, `${p}.exit`, 'exit'),
      exitTo: oneOf(value.exitTo, DIRECTIONS, `${p}.exitTo`, 'direction'),
      delay: num(value.delay, `${p}.delay`),
    };
  };

  const states = (value: unknown, p: string): StateChange[] | undefined => {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) { fail(p, 'Expected an array of state changes.'); return undefined; }
    return value.map((entry, i) => {
      const q = `${p}[${i}]`;
      if (!isRecord(entry)) { fail(q, 'Expected an object.'); return null; }
      const to = oneOf(entry.to ?? entry.state, STATES, `${q}.to`, 'state');
      const at = num(entry.at, `${q}.at`, 0)!;
      if (!to) return null;
      const transition = oneOf(entry.transition, TRANSITIONS, `${q}.transition`, 'transition');
      const change: StateChange = { at, to, ...(transition ? { transition } : {}) };
      return change;
    }).filter((x): x is StateChange => x !== null);
  };

  const stops = (value: unknown, p: string): CursorStop[] => {
    if (!Array.isArray(value)) { fail(p, 'A cursor needs a `stops` array.'); return []; }
    return value.map((entry, i) => {
      const q = `${p}[${i}]`;
      if (!isRecord(entry)) { fail(q, 'Expected an object.'); return null; }
      const stop: CursorStop = {
        x: num(entry.x, `${q}.x`, 0.5)!,
        y: num(entry.y, `${q}.y`, 0.5)!,
        at: num(entry.at, `${q}.at`, 0)!,
        travel: num(entry.travel, `${q}.travel`),
        path: oneOf(entry.path, ['straight', 'arc', 'curve'] as const, `${q}.path`, 'path'),
        action: oneOf(entry.action, ['none', 'click', 'press', 'release', 'hover'] as const, `${q}.action`, 'action'),
        targetId: typeof entry.targetId === 'string' ? entry.targetId : undefined,
        targetState: oneOf(entry.targetState, STATES, `${q}.targetState`, 'state'),
      };
      return stop;
    }).filter((x): x is CursorStop => x !== null);
  };

  const one = (value: unknown, p: string): SceneObject | null => {
    if (!isRecord(value)) { fail(p, 'Expected an object.'); return null; }

    const kind = oneOf(value.type ?? value.kind, OBJECT_KINDS, `${p}.type`, 'object type');
    if (!kind) {
      if (value.type === undefined) fail(`${p}.type`, 'Missing. Every object needs a `type`.');
      return null;
    }

    const base = {
      id: typeof value.id === 'string' && value.id ? value.id : makeId(),
      x: num(value.x, `${p}.x`, 0)!,
      y: num(value.y, `${p}.y`, 0)!,
      width: num(value.width, `${p}.width`, 0.2)!,
      height: num(value.height, `${p}.height`, 0.1)!,
      rotation: num(value.rotation, `${p}.rotation`),
      opacity: num(value.opacity, `${p}.opacity`),
      layer: num(value.layer, `${p}.layer`),
      motion: motion(value.motion, `${p}.motion`),
      start: num(value.start, `${p}.start`),
      duration: num(value.duration, `${p}.duration`),
      states: states(value.states, `${p}.states`),
      note: typeof value.note === 'string' ? value.note : undefined,
    };

    const kids = (): SceneObject[] | undefined => {
      if (value.children === undefined) return undefined;
      const parsed = parseObjects(value.children, `${p}.children`, issues, makeId);
      return parsed ?? undefined;
    };

    switch (kind) {
      case 'shape': {
        const shape = oneOf(value.shape, SHAPES, `${p}.shape`, 'shape');
        if (!shape) { fail(`${p}.shape`, `Missing. Expected one of: ${SHAPES.join(', ')}.`); return null; }
        return { ...base, type: 'shape', shape, surface: surface(value.surface ?? value.style, `${p}.surface`) } as ShapeObject;
      }
      case 'image':
      case 'logo': {
        const src = value.src;
        if (typeof src !== 'string' || src.trim() === '') {
          fail(`${p}.src`, 'Missing. An image needs a `src`.');
          return null;
        }
        return {
          ...base, type: kind, src: src.trim(),
          fit: oneOf(value.fit, FITS, `${p}.fit`, 'fit'),
          surface: surface(value.surface ?? value.style, `${p}.surface`),
        } as ImageObject | LogoObject;
      }
      case 'icon': {
        const icon = oneOf(value.icon ?? value.name, ICONS, `${p}.icon`, 'icon');
        if (!icon) { fail(`${p}.icon`, `Missing. Expected one of: ${ICONS.join(', ')}.`); return null; }
        return {
          ...base, type: 'icon', icon,
          color: typeof value.color === 'string' ? value.color : undefined,
          weight: num(value.weight, `${p}.weight`),
          surface: surface(value.surface ?? value.style, `${p}.surface`),
        } as IconObject;
      }
      case 'card':
        return {
          ...base, type: 'card',
          surface: surface(value.surface ?? value.style, `${p}.surface`),
          title: label(value.title, `${p}.title`),
          body: label(value.body, `${p}.body`),
          children: kids(),
          sequence: oneOf(value.sequence, SEQUENCES, `${p}.sequence`, 'sequence'),
          stagger: num(value.stagger, `${p}.stagger`),
        } as CardObject;
      case 'button': {
        const stateStyles = isRecord(value.stateStyles)
          ? Object.fromEntries(
              Object.entries(value.stateStyles).map(([k, v]) => {
                const state = oneOf(k, STATES, `${p}.stateStyles.${k}`, 'state');
                if (!state || !isRecord(v)) return [k, undefined];
                return [state, { ...surface(v, `${p}.stateStyles.${k}`), label: label(v.label, `${p}.stateStyles.${k}.label`) }];
              }).filter(([, v]) => v !== undefined),
            )
          : undefined;
        return {
          ...base, type: 'button',
          label: label(value.label, `${p}.label`),
          icon: oneOf(value.icon, ICONS, `${p}.icon`, 'icon'),
          surface: surface(value.surface ?? value.style, `${p}.surface`),
          stateStyles,
        } as ButtonObject;
      }
      case 'cursor':
        return {
          ...base, type: 'cursor',
          stops: stops(value.stops, `${p}.stops`),
          variant: oneOf(value.variant, ['arrow', 'hand'] as const, `${p}.variant`, 'cursor style'),
          color: typeof value.color === 'string' ? value.color : undefined,
        } as CursorObject;
      case 'group':
        return {
          ...base, type: 'group',
          children: kids() ?? [],
          sequence: oneOf(value.sequence, SEQUENCES, `${p}.sequence`, 'sequence'),
          stagger: num(value.stagger, `${p}.stagger`),
        } as GroupObject;
    }
  };

  const out = raw.map((entry, i) => one(entry, `${path}[${i}]`))
                 .filter((x): x is SceneObject => x !== null);
  return out.length > 0 ? out : null;
};

/* ------------------------------------------------------------- serialise */

const clean = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) =>
      v !== undefined && !(typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0),
    ),
  ) as T;

const writeSurface = (s: ObjectSurface | undefined) =>
  s === undefined ? undefined : clean({
    fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, radius: s.radius,
    shadow: s.shadow ? shoutObject(s.shadow) : undefined,
    glow: s.glow ? shoutObject(s.glow) : undefined,
    glowColor: s.glowColor, blur: s.blur,
  });

const writeLabel = (l: ObjectLabel | undefined) =>
  l === undefined ? undefined : clean({
    text: l.text, color: l.color, size: l.size, weight: l.weight,
    align: l.align ? shoutObject(l.align) : undefined, tracking: l.tracking,
  });

const writeMotion = (m: SceneObject['motion']) =>
  m === undefined ? undefined : clean({
    enter: m.enter ? shoutObject(m.enter) : undefined,
    from: m.from ? shoutObject(m.from) : undefined,
    speed: m.speed ? shoutObject(m.speed) : undefined,
    distance: m.distance ? shoutObject(m.distance) : undefined,
    emphasis: m.emphasis ? shoutObject(m.emphasis) : undefined,
    exit: m.exit ? shoutObject(m.exit) : undefined,
    exitTo: m.exitTo ? shoutObject(m.exitTo) : undefined,
    delay: m.delay,
  });

export const serialiseObject = (object: SceneObject): Record<string, unknown> => {
  const base = clean({
    id: object.id,
    type: shoutObject(object.type),
    x: object.x, y: object.y, width: object.width, height: object.height,
    rotation: object.rotation, opacity: object.opacity, layer: object.layer,
    start: object.start, duration: object.duration,
    motion: writeMotion(object.motion),
    states: object.states?.map((s) => clean({
      at: s.at, to: shoutObject(s.to),
      transition: s.transition ? shoutObject(s.transition) : undefined,
    })),
    note: object.note,
  });

  switch (object.type) {
    case 'shape':
      return clean({ ...base, shape: shoutObject(object.shape), surface: writeSurface(object.surface) });
    case 'image':
    case 'logo':
      return clean({ ...base, src: object.src,
        fit: object.fit ? shoutObject(object.fit) : undefined,
        surface: writeSurface(object.surface) });
    case 'icon':
      return clean({ ...base, icon: shoutObject(object.icon), color: object.color,
        weight: object.weight, surface: writeSurface(object.surface) });
    case 'card':
      return clean({ ...base, surface: writeSurface(object.surface),
        title: writeLabel(object.title), body: writeLabel(object.body),
        sequence: object.sequence ? shoutObject(object.sequence) : undefined,
        stagger: object.stagger,
        children: object.children?.map(serialiseObject) });
    case 'button':
      return clean({ ...base, label: writeLabel(object.label),
        icon: object.icon ? shoutObject(object.icon) : undefined,
        surface: writeSurface(object.surface),
        stateStyles: object.stateStyles
          ? Object.fromEntries(Object.entries(object.stateStyles).map(([k, v]) => [
              shoutObject(k),
              clean({ ...writeSurface(v), label: writeLabel(v?.label) }),
            ]))
          : undefined });
    case 'cursor':
      return clean({ ...base,
        variant: object.variant ? shoutObject(object.variant) : undefined,
        color: object.color,
        stops: object.stops.map((s) => clean({
          x: s.x, y: s.y, at: s.at, travel: s.travel,
          path: s.path ? shoutObject(s.path) : undefined,
          action: s.action ? shoutObject(s.action) : undefined,
          targetId: s.targetId,
          targetState: s.targetState ? shoutObject(s.targetState) : undefined,
        })) });
    case 'group':
      return clean({ ...base,
        sequence: object.sequence ? shoutObject(object.sequence) : undefined,
        stagger: object.stagger,
        children: object.children.map(serialiseObject) });
  }
};
