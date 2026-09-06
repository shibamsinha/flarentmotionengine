/**
 * Auto-save.
 *
 * The editor holds the whole project in React state, which a tab refresh or a
 * background-tab eviction throws away. Everything that makes up a reel is
 * mirrored into localStorage on a short debounce and restored on boot.
 *
 * Restore is defensive: a payload from an older build, or one that has been
 * corrupted, is discarded rather than crashing the editor into a blank screen.
 * Losing an auto-save is annoying; failing to start is worse.
 */

import type {
  Alignment,
  AnimationStyle,
  BackgroundName,
  CanvasFormat,
  CompositionPreset,
  PaletteName,
  OverlayImage,
  Scene,
  SceneElement,
  SizePreset,
  PositionPreset,
  BackgroundMotion,
  TextCase,
  TextFit,
  TextRole,
  WordStagger,
} from '../types/scene';
import type { FieldOverrides } from './typography';
import type { ProjectAudio } from '../types/audio';
import { VISUAL_STYLE_NAMES } from './visualStyle';
import type { VisualStyleConfig, VisualStyleName } from './visualStyle';
import {
  COMPOSITION_PRESETS,
  POSITION_PRESETS,
  SIZE_PRESETS,
  TEXT_ROLES,
} from './composition';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION } from './timing';

const KEY = 'flarent.motion-engine.project';
const VERSION = 1;

export type PersistedProject = {
  version: number;
  savedAt: number;
  scenes: Scene[];
  palette: PaletteName;
  /** Portrait unless the project chose landscape. */
  format: CanvasFormat;
  fields: FieldOverrides;
  ink: FieldOverrides;
  accent: string | null;
  overlay: OverlayImage | null;
  /** V7 — the project's audio track, or null. Optional in stored payloads. */
  audio: ProjectAudio | null;
  title: string | null;
  selectedId: string | null;
};

const STYLES: AnimationStyle[] = ['massive', 'punch', 'stack', 'slide', 'rapid', 'none'];
const BACKGROUNDS: BackgroundName[] = ['green', 'cream', 'black'];
const ALIGNMENTS: Alignment[] = ['left', 'center', 'right'];
const CASES: TextCase[] = ['lower', 'upper', 'as-typed'];

/** A width fit, kept only when it is a usable fraction of the frame. */
const sanitiseFit = (raw: unknown): TextFit | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const width = (raw as { maxWidth?: unknown }).maxWidth;
  if (typeof width !== 'number' || !Number.isFinite(width)) return undefined;
  if (width <= 0 || width > 1) return undefined;
  return { mode: 'width', maxWidth: width };
};

/** Word stagger, kept only when it is a usable whole number of frames. */
const sanitiseStagger = (raw: unknown): WordStagger | undefined => {
  if (!isRecord(raw)) return undefined;
  const frames = num(raw.delayFrames);
  if (frames === undefined || frames < 0) return undefined;
  const order = raw.order === 'reverse' ? 'reverse' : undefined;
  return { type: 'word', delayFrames: Math.round(frames), ...(order ? { order } : {}) };
};

/** Background alternation, dropped whole if its interval is unusable. */
const sanitiseBackgroundMotion = (raw: unknown): BackgroundMotion | undefined => {
  if (!isRecord(raw) || raw.mode !== 'alternate') return undefined;
  const every = num(raw.everyFrames);
  if (every === undefined || every < 1) return undefined;
  const times = num(raw.times);
  return {
    mode: 'alternate',
    everyFrames: Math.round(every),
    ...(times !== undefined && times >= 0 ? { times: Math.round(times) } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * A visual style config. Kept only if its `type` is one the engine knows —
 * everything inside is optional and resolves against the field colour, so a
 * partially-lost config still paints correctly rather than painting nothing.
 */
const sanitiseStyleConfig = (raw: unknown): VisualStyleConfig | undefined => {
  if (!isRecord(raw)) return undefined;
  if (!VISUAL_STYLE_NAMES.includes(raw.type as VisualStyleName)) return undefined;
  const config: VisualStyleConfig = { type: raw.type as VisualStyleName };
  if (typeof raw.fillColor === 'string') config.fillColor = raw.fillColor;
  if (typeof raw.strokeColor === 'string') config.strokeColor = raw.strokeColor;
  const width = num(raw.strokeWidth);
  if (width !== undefined && width > 0) config.strokeWidth = width;
  const opacity = num(raw.opacity);
  if (opacity !== undefined) config.opacity = Math.min(1, Math.max(0, opacity));
  if (raw.splitBy === 'auto' || raw.splitBy === 'word' || raw.splitBy === 'letter')
    config.splitBy = raw.splitBy;
  if (isRecord(raw.gradient) && Array.isArray(raw.gradient.colors)) {
    const colors = raw.gradient.colors.filter((c): c is string => typeof c === 'string');
    if (colors.length > 0)
      config.gradient = { colors, angle: num(raw.gradient.angle) ?? 90 };
  }
  if (Array.isArray(raw.parts)) {
    const parts = raw.parts
      .map(sanitiseStyleConfig)
      .filter((p): p is VisualStyleConfig => p !== undefined);
    if (parts.length > 0) config.parts = parts;
  }
  return config;
};

/**
 * A V3 element, kept only if it is renderable.
 *
 * Everything but `text` degrades to a default rather than failing: an element
 * that lost its `size` in a bad write should come back as its role's default
 * size, not take the whole scene down with it.
 */
const sanitiseElement = (raw: unknown, index: number): SceneElement | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.text !== 'string' || raw.text.trim() === '') return null;

  const element: SceneElement = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `el-${index}`,
    text: raw.text,
  };

  if (TEXT_ROLES.includes(raw.role as TextRole)) element.role = raw.role as TextRole;
  if (SIZE_PRESETS.includes(raw.size as SizePreset)) element.size = raw.size as SizePreset;
  if (POSITION_PRESETS.includes(raw.position as PositionPreset))
    element.position = raw.position as PositionPreset;
  if (POSITION_PRESETS.includes(raw.from as PositionPreset))
    element.from = raw.from as PositionPreset;
  if (STYLES.includes(raw.animation as AnimationStyle))
    element.animation = raw.animation as AnimationStyle;
  if (ALIGNMENTS.includes(raw.align as Alignment)) element.align = raw.align as Alignment;
  if (CASES.includes(raw.case as TextCase)) element.case = raw.case as TextCase;
  if (VISUAL_STYLE_NAMES.includes(raw.visualStyle as VisualStyleName))
    element.visualStyle = raw.visualStyle as VisualStyleName;
  const elStyle = sanitiseStyleConfig(raw.styleConfig);
  if (elStyle) element.styleConfig = elStyle;
  if (Array.isArray(raw.emphasis))
    element.emphasis = raw.emphasis.filter((w): w is string => typeof w === 'string');

  const scale = num(raw.scale);
  if (scale !== undefined && scale > 0) element.scale = scale;
  const delay = num(raw.delay);
  if (delay !== undefined && delay >= 0) element.delay = delay;
  const enterFrames = num(raw.enterFrames);
  if (enterFrames !== undefined && enterFrames >= 1)
    element.enterFrames = Math.round(enterFrames);
  const elementFit = sanitiseFit(raw.fit);
  if (elementFit) element.fit = elementFit;
  if (STYLES.includes(raw.exit as AnimationStyle)) element.exit = raw.exit as AnimationStyle;
  const elementStagger = sanitiseStagger(raw.stagger);
  if (elementStagger) element.stagger = elementStagger;
  if (raw.fontRole === 'accent' || raw.fontRole === 'primary')
    element.fontRole = raw.fontRole;

  // Manual coordinates only count as a pair — one of the two would place the
  // element somewhere neither the author nor the composition asked for.
  const x = num(raw.x);
  const y = num(raw.y);
  if (x !== undefined && y !== undefined) {
    element.x = x;
    element.y = y;
  }

  return element;
};

/**
 * Keep only scenes the engine can actually render. A single bad entry should
 * cost that scene, not the whole session.
 */
const sanitiseScene = (raw: unknown): Scene | null => {
  if (!isRecord(raw)) return null;
  const { id, text, duration, style, background, alignment } = raw;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof text !== 'string') return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)
    return null;
  if (!STYLES.includes(style as AnimationStyle)) return null;
  if (!BACKGROUNDS.includes(background as BackgroundName)) return null;

  const scene: Scene = {
    id,
    text,
    duration: Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, duration)),
    style: style as AnimationStyle,
    background: background as BackgroundName,
    alignment: ALIGNMENTS.includes(alignment as Alignment)
      ? (alignment as Alignment)
      : 'center',
  };

  if (Array.isArray(raw.emphasis))
    scene.emphasis = raw.emphasis.filter((w): w is string => typeof w === 'string');
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize))
    scene.fontSize = raw.fontSize;
  const sceneEnter = num(raw.enterFrames);
  if (sceneEnter !== undefined && sceneEnter >= 1)
    scene.enterFrames = Math.round(sceneEnter);
  const sceneFit = sanitiseFit(raw.fit);
  if (sceneFit) scene.fit = sceneFit;
  if (STYLES.includes(raw.exit as AnimationStyle)) scene.exit = raw.exit as AnimationStyle;
  const sceneExitFrames = num(raw.exitFrames);
  if (sceneExitFrames !== undefined && sceneExitFrames >= 0)
    scene.exitFrames = Math.round(sceneExitFrames);
  const sceneStagger = sanitiseStagger(raw.stagger);
  if (sceneStagger) scene.stagger = sceneStagger;
  const sceneBackground = sanitiseBackgroundMotion(raw.backgroundMotion);
  if (sceneBackground) scene.backgroundMotion = sceneBackground;
  if (raw.fontRole === 'accent' || raw.fontRole === 'primary')
    scene.fontRole = raw.fontRole;
  if (typeof raw.direction === 'string')
    scene.direction = raw.direction as Scene['direction'];
  if (typeof raw.flipBackground === 'boolean')
    scene.flipBackground = raw.flipBackground;
  if (CASES.includes(raw.case as TextCase)) scene.case = raw.case as TextCase;
  if (typeof raw.note === 'string') scene.note = raw.note;
  if (raw.hideOverlay === true) scene.hideOverlay = true;
  if (COMPOSITION_PRESETS.includes(raw.composition as CompositionPreset))
    scene.composition = raw.composition as CompositionPreset;
  if (VISUAL_STYLE_NAMES.includes(raw.visualStyle as VisualStyleName))
    scene.visualStyle = raw.visualStyle as VisualStyleName;
  const sceneStyle = sanitiseStyleConfig(raw.styleConfig);
  if (sceneStyle) scene.styleConfig = sceneStyle;
  if (Array.isArray(raw.elements)) {
    const elements = raw.elements
      .map(sanitiseElement)
      .filter((element): element is SceneElement => element !== null);
    // An empty list would silently drop the scene back to its V2 `text`, which
    // is a different reel than the one that was saved. Keep the field off
    // entirely rather than half-restoring a composition.
    if (elements.length > 0) scene.elements = elements;
  }
  if (isRecord(raw.image) && typeof raw.image.src === 'string') {
    scene.image = raw.image as unknown as Scene['image'];
  }

  return scene;
};

/**
 * The project-level overlay. Dropped entirely rather than half-restored: an
 * overlay with a lost `src` is an invisible box the user cannot see to delete.
 */
const sanitiseOverlay = (raw: unknown): OverlayImage | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.src !== 'string' || raw.src.trim() === '') return null;
  return {
    src: raw.src,
    x: num(raw.x) ?? 0.08,
    y: num(raw.y) ?? 0.05,
    width: num(raw.width) ?? 0.26,
    height: num(raw.height) ?? 0.09,
    fit: raw.fit === 'cover' ? 'cover' : 'contain',
    opacity: Math.min(1, Math.max(0, num(raw.opacity) ?? 1)),
  };
};

/**
 * The project's audio track.
 *
 * Dropped whole rather than half-restored, for the same reason the overlay is:
 * a track with a lost `src` is silence the user cannot see to remove. A
 * selection that is empty or inverted is also treated as no track — it would
 * render nothing and show a zero-width handle nobody could grab.
 */
const sanitiseAudio = (raw: unknown): ProjectAudio | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.src !== 'string' || raw.src.trim() === '') return null;
  const sourceStart = Math.max(0, num(raw.sourceStart) ?? 0);
  const sourceEnd = num(raw.sourceEnd) ?? 0;
  if (!(sourceEnd > sourceStart)) return null;
  return {
    src: raw.src,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(num(raw.sourceDuration) ? { sourceDuration: num(raw.sourceDuration)! } : {}),
    sourceStart,
    sourceEnd,
    timelineStart: Math.max(0, num(raw.timelineStart) ?? 0),
    volume: Math.min(1, Math.max(0, num(raw.volume) ?? 1)),
    ...(raw.muted === true ? { muted: true } : {}),
    ...((num(raw.fadeIn) ?? 0) > 0 ? { fadeIn: num(raw.fadeIn)! } : {}),
    ...((num(raw.fadeOut) ?? 0) > 0 ? { fadeOut: num(raw.fadeOut)! } : {}),
    ...(raw.loop === true ? { loop: true } : {}),
  };
};

export const loadProject = (): PersistedProject | null => {
  if (typeof window === 'undefined') return null;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    return null; // private mode, blocked storage — carry on without it
  }
  if (!stored) return null;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== VERSION) return null;
    if (!Array.isArray(parsed.scenes)) return null;

    const scenes = parsed.scenes
      .map(sanitiseScene)
      .filter((scene): scene is Scene => scene !== null);
    if (scenes.length === 0) return null;

    const fields: FieldOverrides = {};
    if (isRecord(parsed.fields)) {
      for (const [name, value] of Object.entries(parsed.fields)) {
        if (
          BACKGROUNDS.includes(name as BackgroundName) &&
          typeof value === 'string' &&
          /^#[0-9a-f]{6}$/i.test(value)
        ) {
          fields[name as BackgroundName] = value;
        }
      }
    }

    /* V8 — ink and accent. Absent in every pre-V8 payload, and an empty map is
       the correct reading of that: no override, so the derived ink stands. */
    const ink: FieldOverrides = {};
    if (isRecord(parsed.ink)) {
      for (const [name, value] of Object.entries(parsed.ink)) {
        if (
          BACKGROUNDS.includes(name as BackgroundName) &&
          typeof value === 'string' &&
          /^#[0-9a-f]{6}$/i.test(value)
        ) {
          ink[name as BackgroundName] = value;
        }
      }
    }
    const accent =
      typeof parsed.accent === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.accent)
        ? parsed.accent
        : null;

    const selectedId =
      typeof parsed.selectedId === 'string' &&
      scenes.some((scene) => scene.id === parsed.selectedId)
        ? parsed.selectedId
        : null;

    return {
      version: VERSION,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      scenes,
      palette: parsed.palette === 'ink' ? 'ink' : 'forest',
      format: parsed.format === 'landscape' ? 'landscape' : 'portrait',
      fields,
      ink,
      accent,
      overlay: sanitiseOverlay(parsed.overlay),
      // Absent in every pre-V7 payload; null is the correct reading.
      audio: sanitiseAudio(parsed.audio),
      title: typeof parsed.title === 'string' ? parsed.title : null,
      selectedId,
    };
  } catch {
    return null;
  }
};

export const saveProject = (
  project: Omit<PersistedProject, 'version' | 'savedAt'>,
): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...project, version: VERSION, savedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearProject = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
};
