/**
 * Flarent Motion Engine — core data model.
 *
 * A video is nothing more than an ordered list of scenes. Duration is never
 * hard-coded anywhere: the composition length is always
 *   totalFrames = sum(round(scene.duration * fps))
 * so adding or removing a scene changes the length of the film.
 */

import type { VisualStyleConfig, VisualStyleName } from '../utils/visualStyle';
import type { FontRole } from '../utils/typography';
import type { SceneObject } from './object';
import type { ProjectAudio } from './audio';

/**
 * The animation vocabulary.
 *
 * `none` is a genuine no-motion path, not a very fast animation: its component
 * returns the identity transform on every frame, so a scene using it is a hard
 * cut with type that does not move. Professional kinetic typography leans on
 * held cards and cut-driven rhythm as much as on movement, and simulating that
 * with a one-frame entrance leaves a visible pop.
 */
export type AnimationStyle = 'massive' | 'punch' | 'stack' | 'slide' | 'rapid' | 'none';

export type BackgroundName = 'green' | 'cream' | 'black';

/* ------------------------------------------------------------ V3 vocabulary */

/**
 * What a piece of type is *for*, which is a different question from how big it
 * is. Size follows from the role by default (see ROLE_SIZE) but an author may
 * override it — a SUPPORT line set HUGE is a legitimate art-direction choice.
 *
 * Roles also carry a hierarchy: EMPHASIS ≥ PRIMARY > SECONDARY > SUPPORT. The
 * planner enforces that as a *visual* relationship rather than a numeric one —
 * see `ROLE_CEILING`.
 */
export type TextRole = 'primary' | 'secondary' | 'emphasis' | 'support';

/**
 * Semantic type sizes. Resolved against the 1080-wide canvas, the font metrics
 * and the length of the text — never a hard-coded pixel value.
 *
 * `huge` and `oversized` are allowed to exceed the frame. That is the point of
 * them: the frame is a crop, not a container.
 */
export type SizePreset = 'xs' | 'small' | 'medium' | 'large' | 'huge' | 'oversized';

/**
 * Where a piece of type sits. Semantic rather than numeric so a script — and
 * eventually the motion director — can say CENTER_RIGHT instead of guessing at
 * pixels that only work for one word length.
 *
 * `edge-*` deliberately hangs the ink past the frame edge. `offscreen-*` puts it
 * fully outside, which is mainly useful as an element's entrance origin.
 */
export type PositionPreset =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'edge-left'
  | 'edge-right'
  | 'edge-top'
  | 'edge-bottom'
  | 'offscreen-left'
  | 'offscreen-right'
  | 'offscreen-top'
  | 'offscreen-bottom';

/**
 * A whole-scene layout. Compositions decide where elements go when the elements
 * themselves do not say — they are layouts, not animations, and they never
 * override an explicit `position`.
 */
export type CompositionPreset =
  | 'center'
  | 'left-stack'
  | 'right-stack'
  | 'top-statement'
  | 'bottom-statement'
  | 'split'
  | 'oversized-center'
  | 'corner';

/**
 * V8 — fit type to a share of the frame.
 *
 * The size presets are a *scale*: six steps, art-directed, each with its own
 * bleed policy. That is the right model almost always, and it is deliberately
 * coarse — a scale a designer can hold in their head beats a slider.
 *
 * It stops being right when the requirement is a number: "this line must be 88%
 * of the frame and must not clip". No preset expresses that, because a preset's
 * job is to be length-aware and this is the opposite — an exact width whatever
 * the length. So `fit` sits beside `size` rather than replacing it, and when
 * present it wins.
 *
 * The guarantee is the point: fitted text is measured to land on `maxWidth` and
 * never bleeds past it, whatever the face, the length or the alignment.
 */
export type TextFit = {
  /** Only width-fitting for now; the field exists so height-fitting can be added without a breaking change. */
  mode: 'width';
  /** Share of the frame width the ink should occupy, 0.05–1. */
  maxWidth: number;
};

/**
 * V8.2 — per-word stagger.
 *
 * The engine already understands words: it lays them out individually, colours
 * them individually and promotes them for emphasis. Timing was the one axis that
 * stopped at the element — every word arrived together (or on STACK's fixed
 * build beat) and there was no way to say "two frames apart".
 *
 * This is the missing axis, and it is deliberately *one number plus a direction*
 * rather than a per-word list. A list would be a keyframe track in disguise; a
 * spacing is an intent the planner resolves, which is the same shape `stagger`
 * already has on object groups.
 */
export type WordStagger = {
  /** Only word-level for now; the field exists so letters can be added later. */
  type: 'word';
  /** Frames between one word starting and the next. 0 means they arrive together. */
  delayFrames: number;
  /** Which end goes first. Defaults to forward (reading order). */
  order?: 'forward' | 'reverse';
};

/**
 * V8.2 — a background that changes during a scene.
 *
 * Flarent could already cut the field *between* scenes, and RAPID and STACK cut
 * it on their own internal beats. What it could not do was hold one piece of
 * type still while the field strobed underneath it — a staple of the form, and
 * previously only expressible by duplicating the scene once per flip, which
 * makes the timeline unreadable and the text impossible to edit in one place.
 *
 * The content is untouched by this: only the field alternates, on a fixed frame
 * interval, deterministically. `times` bounds it when the effect should stop
 * partway through rather than run to the end of the scene.
 */
export type BackgroundMotion = {
  /** Only alternation for now — between the scene's field and its palette partner. */
  mode: 'alternate';
  /** Frames each field is held for. Must be at least 1. */
  everyFrames: number;
  /** How many flips to make. Omitted means "for the whole scene". */
  times?: number;
};

/**
 * One independently positioned, sized and animated piece of type.
 *
 * A scene holds a list of these. Everything except `text` is optional: role
 * defaults to PRIMARY, size follows the role, position follows the scene's
 * composition, and animation falls back to the scene's own style — so the
 * shortest useful element is `{ text: "CUSTOMERS" }`.
 */
export type SceneElement = {
  id: string;
  text: string;
  role?: TextRole;
  /**
   * V4 — how this element is painted. Inherits the scene's style when absent,
   * which is what keeps a composition from needing four style declarations to
   * say one thing.
   */
  visualStyle?: VisualStyleName;
  /** Overrides for the style's own defaults: colours, stroke weight, gradient. */
  styleConfig?: VisualStyleConfig;
  /** Overrides the role's default size. */
  size?: SizePreset;
  /**
   * Fit this element to an exact share of the frame width. Overrides `size`.
   * Never clips: the measured ink lands on `maxWidth` and stops there.
   */
  fit?: TextFit;
  /**
   * Which of the two house faces this element is set in. `accent` is the serif
   * italic. Defaults to the scene's `fontRole`, then to `primary`.
   */
  fontRole?: FontRole;
  /** Overrides the composition's default placement. */
  position?: PositionPreset;
  /** Overrides the scene's style for this element alone. */
  animation?: AnimationStyle;
  /**
   * V8.2 — how this element *leaves*, as an animation style.
   *
   * Exits already existed but were implied: a scene's type left in the manner of
   * the style it arrived in. This makes the choice explicit and separable, so a
   * line can punch in and slide out — and `none` means it does not leave at all,
   * it simply cuts.
   *
   * Defaults to the scene's `exit`, then to the element's own animation, which
   * is exactly the behaviour every pre-V8.2 project already had.
   */
  exit?: AnimationStyle;
  /** V8.2 — words enter this many frames apart. Overrides the scene's stagger. */
  stagger?: WordStagger;
  /** Text alignment *within* the element. Defaults to match its position. */
  align?: Alignment;
  /** Words promoted inside this element. Rarely needed — the role does this job. */
  emphasis?: string[];
  /**
   * Per-word colour, keyed by the word in lower case.
   *
   * A deliberately separate axis from `visualStyle`. A style says how the
   * *type* is painted — solid, outlined, a gradient — and applies to a whole
   * element; this says "make this one word red" without changing anything
   * else about it. Keyed by the word rather than by index so it survives the
   * text being re-typed around it, which is the same reasoning `emphasis`
   * uses, and it means marking a repeated word colours every instance.
   *
   * Values are any CSS colour. An unmatched key is simply never applied.
   */
  wordColors?: Record<string, string>;

  case?: TextCase;
  /** Multiplies the resolved size. 1 = the preset's own value. */
  scale?: number;
  /** Seconds to hold before this element enters. */
  delay?: number;
  /**
   * V8 — how long this element's entrance takes, in **frames**.
   *
   * Each style has a measured entrance length (`ENTER_SECONDS`) which is right
   * for the pacing it was designed at. It stops being right at the extremes: a
   * seven-frame scene under PUNCH spends most of its life still arriving, which
   * makes fast cutting impossible.
   *
   * This overrides the style's own length while leaving its *curve* alone — the
   * same easing, the same channels, the same planner. It is emphatically not a
   * keyframe: it says how long, never what happens in between.
   *
   * Frames rather than seconds because the reason to reach for it is always
   * frame-accurate cutting, and 2 is a clearer thing to write than 0.0667.
   * Clamped to the element's available window at plan time, so asking for a
   * longer entrance than the scene can hold shortens it rather than overrunning.
   */
  enterFrames?: number;
  /** Entrance origin. An `offscreen-*` value throws the element in from there. */
  from?: PositionPreset;
  /**
   * Manual placement of the ink centre, as fractions of the frame. Escape hatch
   * for the cases semantic positions cannot express; set either both or neither.
   * Elements placed this way are exempt from collision nudging — raw coordinates
   * are honoured exactly.
   */
  x?: number;
  y?: number;
};

/**
 * A palette is a *pair* of fields — one dark, one light — that the reel cuts
 * between. It is project-level rather than per-scene because "flip the field"
 * (RAPID, STACK) needs an unambiguous partner for cream.
 */
export type PaletteName = 'forest' | 'ink';

export type Alignment = 'left' | 'center' | 'right';

export type SlideDirection = 'left' | 'right' | 'top' | 'bottom';

export type TextCase = 'lower' | 'upper' | 'as-typed';

/**
 * How a scene's image sits in the frame.
 *   full  — edge to edge, type over it, tinted with the field colour
 *   panel — an inset plate; the type takes the space left over
 *   split — the image owns half the frame, the type owns the other half
 *   free  — an arbitrary box you position and size yourself
 *
 * The first three are art-directed presets. `free` is what you get the moment
 * you drag the picture on the canvas.
 */
export type ImagePlacement = 'full' | 'panel' | 'split' | 'free';

export type ImageSide = 'top' | 'bottom';

export type ImageFit = 'cover' | 'contain';

/** Whether the picture sits under the type or over it. `free` only. */
export type ImageLayer = 'behind' | 'front';

export type SceneImage = {
  /**
   * Either a path inside `public/` (resolved with staticFile — this is what
   * the upload endpoint returns) or an absolute http(s) URL.
   */
  src: string;
  placement: ImagePlacement;
  /** panel / split — which half of the frame the image occupies. */
  side?: ImageSide;
  /** panel — band height as a fraction of frame height. */
  size?: number;
  /** How much of the field colour is laid over the image, 0..1. */
  scrim?: number;
  /** Focal point for the crop, 0..1 each. Defaults to centre. */
  focusX?: number;
  focusY?: number;

  /**
   * free — the picture box, as fractions of the frame with a top-left origin.
   * Values outside 0..1 are allowed and bleed off the edge on purpose.
   */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** free — `contain` letterboxes inside the box instead of cropping. */
  fit?: ImageFit;
  layer?: ImageLayer;
  /** Natural pixel size, remembered at upload so the box can match the source. */
  naturalWidth?: number;
  naturalHeight?: number;
};

/**
 * A project-level image that sits over the whole reel.
 *
 * Deliberately *not* a `SceneImage`. A scene image is composed with the type —
 * it takes a placement, carves a band out of the frame, and animates on the
 * scene's own entrance. An overlay does none of that: it is one static element
 * rendered outside the scene series, so it cannot inherit a scene's motion,
 * cannot be re-timed by a scene boundary, and does not move the type around it.
 *
 * A logo, a watermark, a grain plate, a fixed caption bar.
 */
export type OverlayImage = {
  /** A path inside `public/` (what the upload endpoint returns) or an http(s) URL. */
  src: string;
  /** Box in frame fractions, top-left origin. Values outside 0..1 bleed off. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** `contain` letterboxes inside the box; `cover` crops to fill it. */
  fit?: ImageFit;
  /** 0..1. */
  opacity?: number;
};

export type Scene = {
  id: string;
  /** Seconds. The single source of truth for this scene's length. */
  duration: number;
  text: string;
  style: AnimationStyle;
  background: BackgroundName;
  alignment: Alignment;
  /**
   * Words (case-insensitive) promoted to hero scale. When omitted each style
   * falls back to its own sensible default — usually "the last word wins".
   */
  emphasis?: string[];
  /**
   * Per-word colour, keyed by the word in lower case.
   *
   * A deliberately separate axis from `visualStyle`. A style says how the
   * *type* is painted — solid, outlined, a gradient — and applies to a whole
   * element; this says "make this one word red" without changing anything
   * else about it. Keyed by the word rather than by index so it survives the
   * text being re-typed around it, which is the same reasoning `emphasis`
   * uses, and it means marking a repeated word colours every instance.
   *
   * Values are any CSS colour. An unmatched key is simply never applied.
   */
  wordColors?: Record<string, string>;
  /**
   * Multiplies the style's natural type size. 1 = the art-directed default.
   * Named `fontSize` to match the documented scene schema.
   */
  fontSize?: number;
  /**
   * V8.2 — how this scene's type leaves, as an animation style.
   *
   * Defaults to `style`, which is what every existing project does. `none`
   * removes the exit entirely and makes the boundary a hard cut.
   */
  exit?: AnimationStyle;
  /**
   * V8.2 — how long the exit takes, in frames.
   *
   * Overrides the per-style overlap length. Still bounded by a third of the
   * *incoming* scene, because a seam that eats the next scene is a bug however
   * deliberately it was asked for.
   */
  exitFrames?: number;
  /** V8.2 — words enter this many frames apart. Inherited by elements. */
  stagger?: WordStagger;
  /** V8.2 — alternate the field during the scene while the type holds. */
  backgroundMotion?: BackgroundMotion;
  /** Scene-wide fit, inherited by elements that do not set their own. */
  fit?: TextFit;
  /** Scene-wide face, inherited by elements that do not set their own. */
  fontRole?: FontRole;
  /**
   * V8 — the scene's default entrance length in frames.
   *
   * Every element that does not set its own `enterFrames` inherits this, which
   * is what makes "cut this whole scene fast" one field rather than one per
   * line. Element beats scene, scene beats the style's measured default.
   */
  enterFrames?: number;
  /** SLIDE only — which edge the type travels in from. */
  direction?: SlideDirection;
  /** RAPID only — flip the background on every beat (the reference behaviour). */
  flipBackground?: boolean;
  case?: TextCase;
  /**
   * V3 — the scene's layout. Only consulted when `elements` is present; it
   * decides where elements go that do not name a position of their own.
   */
  composition?: CompositionPreset;
  /**
   * V4 — how the scene's type is painted, independently of how it moves.
   *
   * Animation and visual style are deliberately two fields, not one: every
   * combination of the five animations and the four styles is valid, and no
   * component knows about both.
   */
  visualStyle?: VisualStyleName;
  /** Overrides for the style's defaults. Elements may override again. */
  styleConfig?: VisualStyleConfig;
  /**
   * V3 — independently positioned pieces of type.
   *
   * When present this is what renders and `text` is left alone as the authoring
   * source. When absent the scene plans exactly as it did in V2: one block, one
   * hero line, support words in typed order. That fallback is why every V2 reel
   * still renders frame for frame.
   */
  elements?: SceneElement[];
  /** Optional picture layer. The type composes around it. */
  image?: SceneImage;
  /**
   * V6 — motion-graphics objects: shapes, images, icons, cards, buttons, a
   * cursor.
   *
   * Deliberately a *second* list beside `elements` rather than a replacement
   * for it. Type keeps its own specialised model — roles, semantic sizes,
   * compositions, visual styles — because that model is what the engine is
   * good at, and a generic box would throw all of it away. A scene without
   * this key takes exactly the code path it did before V6, which is the whole
   * backward-compatibility story in one sentence.
   *
   * Objects render above the type unless they carry a negative `layer`.
   */
  objects?: SceneObject[];
  /**
   * Drop the project's static overlay for this scene only.
   *
   * The overlay is a property of the reel, so this is an exception rather than
   * a setting — one scene where the logo would land on top of the word, or a
   * full-bleed photo beat that wants the frame to itself.
   */
  hideOverlay?: boolean;
  /**
   * Free-text direction carried through from an imported script's
   * `visualNote`. Never rendered — it exists so the reasoning behind a scene
   * survives the trip into the editor.
   */
  note?: string;
};

/** The per-word contract every motion style plans against. */
export type WordAnimation = {
  text: string;
  /** Frames, relative to the start of the scene. */
  start: number;
  /** Frames. */
  duration: number;
  style: AnimationStyle;
  fontSize?: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
};

export type VideoConfig = {
  width: number;
  height: number;
  fps: number;
};

/**
 * A project's frame shape. Picked once per project, the same tier as the
 * palette — never per-scene, and never a raw width/height, so the whole
 * engine can reason about "the frame" without asking which orientation.
 */
export type CanvasFormat = 'portrait' | 'landscape';

/** Everything the Remotion composition needs. Serialisable — it crosses the
 *  process boundary to the render server as inputProps. */
export type FlarentVideoProps = {
  scenes: Scene[];
  /** Defaults to 'portrait' (1080×1920) when absent. */
  format?: CanvasFormat;
  /** Defaults to 'forest' (green · cream) when absent. */
  palette?: PaletteName;
  /** Per-project field colours, e.g. an imported script's backgroundPalette. */
  fields?: Partial<Record<BackgroundName, string>>;
  /**
   * V8 — explicit ink per field. Where `fields` sets the ground, this sets the
   * type on it, and unlike the derived ink it is honoured exactly as given.
   */
  ink?: Partial<Record<BackgroundName, string>>;
  /** V8 — the project accent, used as the default fill for graphic objects. */
  accent?: string;
  /** A static image over the whole reel. Scenes may opt out individually. */
  overlay?: OverlayImage;
  /**
   * V7 — the project's audio track. Project-level, like the overlay: it plays
   * across the whole film and belongs to no scene.
   */
  audio?: ProjectAudio;
};
