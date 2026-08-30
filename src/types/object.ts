/**
 * V6 — scene objects.
 *
 * A scene could previously hold type and one picture. It can now also hold a
 * list of *objects*: shapes, images, icons, cards, buttons, logos, a cursor.
 * This is what makes motion graphics possible alongside the kinetic typography
 * the engine was built for.
 *
 * **This is an addition, not a replacement.** `Scene.objects` sits beside
 * `Scene.elements`, and a scene without it takes exactly the code path it
 * always did — same planner, same components, same pixels. Text keeps its own
 * specialised model (`SceneElement`, roles, semantic sizes, compositions,
 * visual styles) because that model earns its complexity; flattening type into
 * a generic box would lose all of it. V3 already established this shape by
 * keeping `planSingle` and `planComposed` as separate paths rather than merging
 * them, and for the same reason.
 *
 * **Geometry convention.** Every object is a box given in *fractions of the
 * frame* with a top-left origin, which is the convention `SceneImage` (free
 * placement) and `OverlayImage` already use. Fractions rather than pixels
 * because the project can be portrait or landscape and an object should not
 * have to be re-authored when the format changes. Values outside 0..1 are legal
 * and bleed off the edge on purpose.
 *
 * **Timing.** `start` and `duration` are seconds relative to the start of the
 * scene, not frames — the brief is explicit that a user should never have to
 * think in frames. Omitted means "the whole scene".
 */

import type { EnterMotion, EmphasisMotion, ExitMotion, MotionSpeed, MotionDistance, MotionDirection } from '../utils/objectMotion';

/** What kind of thing an object is. Drives which renderer and which controls. */
export type ObjectKind =
  | 'shape'
  | 'image'
  | 'icon'
  | 'card'
  | 'button'
  | 'logo'
  | 'cursor'
  | 'group';

export type ShapeKind = 'rectangle' | 'rounded' | 'circle' | 'line';

/**
 * The small built-in icon set. Deliberately small — the brief rules out an icon
 * marketplace, and these are the ones product-demo motion actually needs.
 * Rendered as SVG paths so they scale and recolour cleanly.
 */
export type IconName =
  | 'check'
  | 'plus'
  | 'upload'
  | 'download'
  | 'folder'
  | 'file'
  | 'camera'
  | 'scan'
  | 'search'
  | 'arrow-right'
  | 'chevron-right'
  | 'close'
  | 'heart'
  | 'star'
  | 'bell'
  | 'user'
  | 'lock'
  | 'play';

/**
 * A named state an interactive object can be in. The brief asks for state
 * changes (a button going default → pressed → success) without exposing
 * keyframes, so states are named and the transition between them is generated.
 */
export type ObjectState = 'default' | 'hover' | 'pressed' | 'active' | 'success' | 'error';

export type StateTransition = 'instant' | 'smooth' | 'spring' | 'morph' | 'fade';

/** One scheduled state change, in seconds from the start of the scene. */
export type StateChange = {
  at: number;
  to: ObjectState;
  transition?: StateTransition;
};

/** How an object is painted. Shared by every kind that has a surface. */
export type ObjectSurface = {
  /** CSS colour. Omitted means transparent. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Corner radius as a fraction of the box's shorter side, 0..0.5. */
  radius?: number;
  /** Preset shadow depth rather than a raw box-shadow string. */
  shadow?: 'none' | 'soft' | 'medium' | 'strong';
  /** A soft coloured bloom behind the object. Reads as "lit". */
  glow?: 'none' | 'low' | 'medium' | 'high';
  glowColor?: string;
  /** Gaussian blur in px at the project's own scale. */
  blur?: number;
};

/** Text carried *by* an object — a button's label, a card's title. */
export type ObjectLabel = {
  text: string;
  color?: string;
  /** Fraction of the frame width. Resolved the same way for any format. */
  size?: number;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  /** Uppercase / letter-spaced treatment, matching the editor's own chrome. */
  tracking?: number;
};

export type ObjectMotion = {
  enter?: EnterMotion;
  /** SLIDE-family only — which edge it comes from. */
  from?: MotionDirection;
  /** How long the entrance takes. Not seconds: the user picks a feel. */
  speed?: MotionSpeed;
  /** How far it travels. */
  distance?: MotionDistance;
  emphasis?: EmphasisMotion;
  exit?: ExitMotion;
  exitTo?: MotionDirection;
  /** Seconds to hold before entering, on top of the object's own `start`. */
  delay?: number;
};

/** How a group's children are timed relative to each other. */
export type SequenceMode = 'together' | 'after' | 'stagger';

type ObjectBase = {
  id: string;
  /** Box in frame fractions, top-left origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees. */
  rotation?: number;
  /** 0..1, multiplied with whatever the motion is doing. */
  opacity?: number;
  /**
   * Painter's order within the scene. Higher sits in front. Objects always
   * render above the scene's type unless this is negative — which is how
   * "put the card behind the headline" is expressed without a layer panel.
   */
  layer?: number;
  motion?: ObjectMotion;
  /** Seconds from the scene's start. Defaults to 0. */
  start?: number;
  /** Seconds. Defaults to the rest of the scene. */
  duration?: number;
  /** Scheduled state changes, for kinds that have states. */
  states?: StateChange[];
  /** Free-text direction, carried through from an imported script. Never rendered. */
  note?: string;
};

export type ShapeObject = ObjectBase & {
  type: 'shape';
  shape: ShapeKind;
  surface?: ObjectSurface;
};

export type ImageObject = ObjectBase & {
  type: 'image';
  /** A path inside `public/` (what the upload endpoint returns) or an http(s) URL. */
  src: string;
  fit?: 'cover' | 'contain';
  surface?: ObjectSurface;
};

/** A logo is an image that says what it is, so the editor can offer the brand asset. */
export type LogoObject = ObjectBase & {
  type: 'logo';
  src: string;
  fit?: 'cover' | 'contain';
  surface?: ObjectSurface;
};

export type IconObject = ObjectBase & {
  type: 'icon';
  icon: IconName;
  color?: string;
  /** Stroke weight of the glyph, in its own 24-unit viewBox. */
  weight?: number;
  surface?: ObjectSurface;
};

export type CardObject = ObjectBase & {
  type: 'card';
  surface?: ObjectSurface;
  title?: ObjectLabel;
  body?: ObjectLabel;
  /** Children live in the card's own box, addressed in *its* fractions. */
  children?: SceneObject[];
  /** How the children are timed against each other. */
  sequence?: SequenceMode;
  /** Seconds between children when `sequence` is 'stagger'. */
  stagger?: number;
};

export type ButtonObject = ObjectBase & {
  type: 'button';
  label?: ObjectLabel;
  icon?: IconName;
  surface?: ObjectSurface;
  /**
   * How the button looks in each state it is put into. Only the states that
   * differ need an entry; anything absent falls back to the base surface.
   */
  stateStyles?: Partial<Record<ObjectState, ObjectSurface & { label?: ObjectLabel }>>;
};

/**
 * The pointer. One per scene is the sensible number, and it is what makes a
 * product demo read as a demo rather than as a slideshow.
 *
 * Its path is a list of stops rather than a curve editor: "be here, then move
 * to there over this long, then click". A click can drive another object's
 * state change, which is how "cursor clicks the button and the button goes to
 * success" is expressed without wiring keyframes together.
 */
export type CursorObject = ObjectBase & {
  type: 'cursor';
  stops: CursorStop[];
  /** Pointer style. */
  variant?: 'arrow' | 'hand';
  color?: string;
};

export type CursorStop = {
  /** Target box centre, in frame fractions. */
  x: number;
  y: number;
  /** Seconds to arrive. */
  at: number;
  /** Seconds the travel takes. */
  travel?: number;
  /** The shape of the move. Straight unless said otherwise. */
  path?: 'straight' | 'arc' | 'curve';
  /** What happens on arrival. */
  action?: 'none' | 'click' | 'press' | 'release' | 'hover';
  /** Object id this action drives, and the state it puts it into. */
  targetId?: string;
  targetState?: ObjectState;
};

export type GroupObject = ObjectBase & {
  type: 'group';
  children: SceneObject[];
  sequence?: SequenceMode;
  stagger?: number;
};

export type SceneObject =
  | ShapeObject
  | ImageObject
  | IconObject
  | CardObject
  | ButtonObject
  | LogoObject
  | CursorObject
  | GroupObject;

/** Kinds that can hold children. */
export const CONTAINER_KINDS: ObjectKind[] = ['card', 'group'];

export const isContainer = (
  object: SceneObject,
): object is CardObject | GroupObject =>
  object.type === 'card' || object.type === 'group';
