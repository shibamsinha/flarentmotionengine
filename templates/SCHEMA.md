# Flarent script schema

What **Import JSON** accepts. `templates/script-template.json` is a working
starting point; `templates/script-full-reference.json` shows every field.

The block below is written to be pasted into a prompt as-is when you want a
model to generate a script.

---

## Document

| field | required | notes |
| --- | --- | --- |
| `scenes` | **yes** | Non-empty array. A bare array of scenes is also accepted as the whole document. |
| `title` | no | Shown in the editor header. |
| `backgroundPalette` | no | `{ "green": "#13581D", "cream": "#EEEEEE", "black": "#0F0F0F" }`. Overrides the field colours for this reel. Ink is contrast-checked against any override. |
| `width`, `height` | no | Checked and warned about. The engine renders 1080×1920 regardless. |
| `fps` | no | Checked and warned about. The engine renders at 30fps regardless. |
| `estimatedDuration` | no | Checked against the sum of durations; a mismatch is a warning. |
| `format` | no | Accepted and ignored. |

## Scene

| field | required | values | notes |
| --- | --- | --- | --- |
| `text` | **yes** | any non-empty string | `\n` forces a line break. |
| `duration` | **yes** | seconds, > 0 | Clamped to 0.15–12s. |
| `animation` | **yes** | `MASSIVE` `PUNCH` `STACK` `SLIDE` `RAPID` | Case-insensitive. |
| `background` | **yes** | `GREEN` `CREAM` `BLACK` | Using `BLACK` anywhere switches the reel to the black · cream palette. |
| `alignment` | no | `LEFT` `CENTER` `RIGHT` | Default `CENTER`. |
| `direction` | no | `LEFT` `RIGHT` `TOP` `BOTTOM` `CENTER` `NONE` | Only SLIDE uses it. `CENTER`/`NONE` mean no travel. |
| `emphasis` | no | array of words or phrases | These become the large hero type. Phrases are split into words. Empty ⇒ the last word wins. |
| `id` | no | string | Generated if missing or duplicated. |
| `start` | no | seconds | Read and checked against the running total, then ignored — timing always comes from durations. |
| `case` | no | `lower` `upper` `as-typed` | Default `as-typed`, so a script in caps renders in caps. |
| `scale` | no | number, default `1` | Multiplies the style's natural type size. |
| `flipBackground` | no | boolean | RAPID / STACK: cut the field on every beat. |
| `image` | no | object | See below. |
| `visualNote` | no | string | Carried onto the scene and shown in the editor. Never rendered. |

### `image`

| field | required | values | notes |
| --- | --- | --- | --- |
| `src` | **yes** | `uploads/x.jpg` or an absolute URL | Uploaded files are the reliable path; a URL needs the network at render time. |
| `placement` | no | `full` `panel` `split` `free` | Default `full`. |
| `side` | no | `top` `bottom` | Default `top`. panel / split only. |
| `size` | no | 0.18–0.72 | Band height as a fraction of the frame. panel only. |
| `scrim` | no | 0–0.9 | Field colour laid over the picture. full only. |
| `focusX`, `focusY` | no | 0–1 | Focal point for the crop. Default centre. |
| `x`, `y`, `width`, `height` | no | fractions of the frame | free only. Top-left origin; values outside 0–1 bleed off the edge on purpose. |
| `fit` | no | `cover` `contain` | free only. Default `cover`. |
| `layer` | no | `behind` `front` | free only. Whether the picture sits under or over the type. Default `behind`. |

---

## Rules the engine applies

- **Reading order is never rearranged.** Words render in the order they are
  written. Un-emphasised words *before* the hero become the small line above
  it; un-emphasised words *after* become the small line below. `"I'D TATTOO"`
  with `emphasis: ["TATTOO"]` reads "I'D" then "TATTOO", never the reverse.
- **Duration is authoritative, `start` is not.** Scenes play back to back.
  Durations are snapped to the 30fps grid cumulatively, so a 25.6s script lands
  on exactly 768 frames rather than drifting.
- **All-or-nothing validation.** Any error and nothing is imported; every
  problem in the file is reported at once. Unknown values for `animation`,
  `background`, `alignment` or `direction` are errors, not silent fallbacks.

## Style guidance

- `MASSIVE` — the payoff word. Five characters or fewer crop past the frame
  edge. Give it 0.6–1.2s.
- `PUNCH` — the workhorse. 0.4–0.8s.
- `STACK` — builds word by word; each step is ~0.3s and the last word holds the
  rest. Needs 0.6s+ and reads best with 2–4 words.
- `SLIDE` — travels in from an edge. Pair with a real `direction`.
- `RAPID` — a list. Splits on line breaks, then on sentence punctuation
  (`AI. DESIGN. WEBSITES.`), then on words. Allow ~0.35s per item.

Keep scenes to **1–4 words**. This is display typography, not subtitles — a
seven-word scene shrinks to the point where nothing lands.

---

## Prompt block

```
Produce a Flarent motion-engine script as JSON.

{
  "title": string,
  "backgroundPalette": { "green": "#13581D", "cream": "#EEEEEE" },
  "scenes": [
    {
      "id": "scene-01",
      "duration": 0.65,                      // seconds, 0.15–12
      "text": "7 RULES",                     // 1–4 words
      "emphasis": ["7"],                     // words to set large
      "animation": "PUNCH",                  // MASSIVE|PUNCH|STACK|SLIDE|RAPID
      "direction": "CENTER",                 // LEFT|RIGHT|TOP|BOTTOM|CENTER
      "alignment": "CENTER",                 // LEFT|CENTER|RIGHT
      "background": "GREEN",                 // GREEN|CREAM|BLACK
      "visualNote": "Immediate opening punch."
    }
  ]
}

Rules:
- Words render in the order written. Un-emphasised words before the emphasised
  one sit above it, after it sit below. Do not reorder to put the hero first.
- Scenes play back to back; duration is the only timing input.
- 1–4 words per scene. MASSIVE for payoff words of five characters or fewer.
- Alternate GREEN and CREAM to give the reel rhythm.
- Return JSON only, no prose.
```

---

# V3 — composition

Everything above still works and still renders exactly as it did. V3 adds one
optional field, `elements`, which turns a scene from *one block of text* into a
**composition of independently placed pieces of type**. A scene has elements or
it does not; there is no half-way state.

```json
{
  "duration": 2.0,
  "composition": "SPLIT",
  "background": "GREEN",
  "animation": "PUNCH",
  "elements": [
    { "text": "You don't need", "role": "SECONDARY", "size": "MEDIUM",    "position": "TOP_LEFT",     "animation": "SLIDE"  },
    { "text": "MORE",           "role": "EMPHASIS",  "size": "OVERSIZED", "position": "CENTER",       "animation": "MASSIVE" },
    { "text": "followers.",     "role": "SUPPORT",   "size": "SMALL",     "position": "BOTTOM_RIGHT", "animation": "PUNCH"  }
  ]
}
```

Only `text` is required on an element. Leave a field out and it is inherited:
size from the role, position from the composition, animation from the scene.
**Leaving fields out is the normal case** — a document where every element
spells out every field is usually over-specified.

## `role` — what the type is for

| role | job | default size |
| --- | --- | --- |
| `PRIMARY` | the main message | `LARGE` |
| `SECONDARY` | the supporting statement | `MEDIUM` |
| `EMPHASIS` | the one word that matters; moves hardest | `HUGE` |
| `SUPPORT` | small context; must never compete | `SMALL` |

Roles are a hierarchy, not just labels. A lower role is capped against whatever
dominates the frame, so a three-letter `SUPPORT` word cannot out-measure a long
`PRIMARY` line that had to shrink. The cap applies only when the size was
inherited — an explicit `size` is you overruling it on purpose.

**Use one dominant role per scene, plus at most one or two others.** Four roles
in one frame is clutter, not hierarchy.

## `size` — how big

`XS` · `SMALL` · `MEDIUM` · `LARGE` · `HUGE` · `OVERSIZED`

Resolved against the canvas, the font metrics and the length of the text — never
a pixel value. `LARGE` fills the reference's measured hero band (~0.84 of the
frame width). `HUGE` reaches the edges. `OVERSIZED` goes past them.

**Overhang shrinks as words get longer**, because a short word survives being
cropped and a long one does not:

| at `OVERSIZED` | width | visible |
| --- | --- | --- |
| `MORE` (4) | 1.29 × frame | 77% |
| `CUSTOMERS` (9) | 1.14 × frame | 87% |
| `A BUSINESS PLAN` (15) | 1.02 × frame | 98% |

Type is **not** shrunk to fit. The frame is a clipping window and running past
it is the intended look. The engine only intervenes when so little of the word
is left that it has stopped being a word.

## `position` — where it sits

```
TOP_LEFT      TOP_CENTER      TOP_RIGHT
CENTER_LEFT   CENTER          CENTER_RIGHT
BOTTOM_LEFT   BOTTOM_CENTER   BOTTOM_RIGHT

EDGE_LEFT   EDGE_RIGHT   EDGE_TOP   EDGE_BOTTOM        hangs past that edge
OFFSCREEN_LEFT  OFFSCREEN_RIGHT  OFFSCREEN_TOP  OFFSCREEN_BOTTOM
```

Semantic only — do not compute pixels. `OFFSCREEN_*` is most useful as an
element's `from`, which throws it in from outside the frame.

## `composition` — the scene's layout

`CENTER` · `LEFT_STACK` · `RIGHT_STACK` · `TOP_STATEMENT` ·
`BOTTOM_STATEMENT` · `SPLIT` · `OVERSIZED_CENTER` · `CORNER`

A composition places the elements that did **not** name a position; it never
overrides one that did. Elements without a position flow in reading order, so
they cannot collide. Omit `composition` and one is chosen from the elements.

## Other element fields

| field | meaning |
| --- | --- |
| `animation` | overrides the scene's style for this element |
| `align` | text alignment inside the element; defaults to match its position |
| `case` | `lower` / `upper` / `as-typed` |
| `scale` | multiplies the resolved size |
| `delay` | seconds to hold before this element enters — how you stagger a composition |
| `from` | entrance origin, e.g. `OFFSCREEN_LEFT` |
| `x`, `y` | manual ink centre as frame fractions; both or neither. Escape hatch |

## V3 prompt block

```
Produce a Flarent motion-engine V3 script as JSON.

{
  "title": string,
  "scenes": [
    {
      "duration": 2.0,                       // seconds, 0.15–12
      "background": "GREEN",                 // GREEN|CREAM|BLACK
      "animation": "PUNCH",                  // default for elements
      "composition": "SPLIT",                // CENTER|LEFT_STACK|RIGHT_STACK|
                                             // TOP_STATEMENT|BOTTOM_STATEMENT|
                                             // SPLIT|OVERSIZED_CENTER|CORNER
      "elements": [
        {
          "text": "MORE",                    // 1–4 words
          "role": "EMPHASIS",                // PRIMARY|SECONDARY|EMPHASIS|SUPPORT
          "size": "OVERSIZED",               // XS|SMALL|MEDIUM|LARGE|HUGE|OVERSIZED
          "position": "CENTER",              // semantic position, never pixels
          "animation": "MASSIVE",            // MASSIVE|PUNCH|STACK|SLIDE|RAPID
          "delay": 0.1                       // optional stagger, seconds
        }
      ],
      "visualNote": "Why this frame looks like this."
    }
  ]
}

Rules:
- Design each frame so it would work paused: hierarchy, contrast, negative
  space, deliberate asymmetry. Do not centre everything.
- One dominant element per scene, plus at most one or two supporting ones.
  Most scenes need one or two elements, not four.
- Words render in the order written. Never reorder to put the hero first.
- Omit any field the element should inherit. Do not fill in every field.
- OVERSIZED is for words of roughly nine characters or fewer; it is meant to be
  cropped by the frame.
- Alternate GREEN and CREAM to give the reel rhythm.
- Return JSON only, no prose.
```

---

# Static overlay

One image over the whole reel, independent of every scene — a logo or watermark.
Document level, not scene level:

```json
{
  "title": "...",
  "overlay": {
    "src": "uploads/logo.png",
    "x": 0.62, "y": 0.045,
    "width": 0.30, "height": 0.09,
    "fit": "contain",
    "opacity": 1
  },
  "scenes": [
    { "duration": 2.0, "text": "CUSTOMERS", "animation": "MASSIVE",
      "background": "GREEN", "hideOverlay": true }
  ]
}
```

`x` / `y` / `width` / `height` are fractions of the frame, top-left origin, and
are **not** clamped — hanging the overlay off an edge is a legitimate placement.
It never animates and never moves the type around it.

Add `"hideOverlay": true` to any scene that should not show it — typically a
scene whose type would collide with it, or a full-bleed image beat.

---

# V4 — visual styles

`animation` says how type **moves**. `visualStyle` says how it **looks**. They
are two independent fields and every combination of the five animations and the
four styles is valid.

```json
{
  "duration": 2.0,
  "background": "GREEN",
  "animation": "MASSIVE",
  "visualStyle": "GRADIENT",
  "elements": [
    { "text": "You don't need", "role": "SECONDARY", "visualStyle": "SOLID" },
    { "text": "MORE",           "role": "EMPHASIS",  "size": "OVERSIZED" }
  ]
}
```

An element with no `visualStyle` **inherits the scene's**. Above, "MORE" is the
gradient and only the setup line had to say otherwise.

## The four styles

| style | what it is | when to reach for it |
| --- | --- | --- |
| `SOLID` | one colour, filled | statements, setup, explanation |
| `OUTLINE` | hollow letters drawn as a stroke | contrast, tension, the quiet beat |
| `GRADIENT` | a ramp painted inside the glyphs | the idea that matters; energy, climax |
| `SPLIT` | two treatments in one piece of type | comparisons, two-part ideas |

**Do not switch style every scene.** Dynamic styles are not a requirement to be
different each time; a reel that changes treatment constantly reads as
amateurish. Reserve `GRADIENT` for the one or two moments that carry the piece.

## `styleConfig` — optional overrides

Every field is optional, and leaving one out is the normal case: colours default
to the ink that reads on the scene's field, so `"visualStyle": "SOLID"` on green
is white and on cream is deep green without being told.

```json
{
  "visualStyle": "OUTLINE",
  "styleConfig": {
    "type": "OUTLINE",
    "strokeColor": "#FFFFFF",
    "strokeWidth": 0.03
  }
}
```

| field | style | meaning |
| --- | --- | --- |
| `fillColor` | SOLID, OUTLINE | glyph fill. Omit on OUTLINE for a hollow letter |
| `strokeColor` | OUTLINE | stroke colour |
| `strokeWidth` | OUTLINE | **a fraction of the type size**, not pixels. 0.03 = 3% |
| `gradient` | GRADIENT | `{ "colors": [...], "angle": 90 }`, two or more colours |
| `opacity` | any | 0–1 |
| `parts` | SPLIT | the treatments to alternate between |
| `splitBy` | SPLIT | `AUTO` / `WORD` / `LETTER` |

`strokeWidth` is a ratio because a fixed pixel weight gives an OVERSIZED word a
hairline and a caption a slab. A value above 1 is read as a percentage and
warned about.

Colours accept hex or a token: `WHITE`, `BLACK`, `CREAM`, `DARK_GREEN`,
`DEEP_GREEN`, `BLUE`.

## V4 prompt block

```
Produce a Flarent motion-engine V4 script as JSON.

Each scene has BOTH an animation and a visual style. They are independent:

  "animation":   MASSIVE | PUNCH | STACK | SLIDE | RAPID     (how it moves)
  "visualStyle": SOLID | OUTLINE | GRADIENT | SPLIT          (how it looks)

Rules:
- Choose style for a reason, not for variety. SOLID carries the argument;
  OUTLINE is the quieter beat that sets up a loud one; GRADIENT is reserved
  for the one or two moments that matter; SPLIT is for two-part ideas.
- At most two GRADIENT scenes in a short reel. Spending it early leaves the
  ending with nothing.
- Elements inherit the scene's visualStyle. Only name one when it differs.
- Omit styleConfig entirely unless a specific colour is required — defaults
  already read correctly on both fields.
- Everything from V3 still applies: roles, semantic sizes and positions,
  compositions, and designing each frame so it works paused.
- Return JSON only, no prose.
```

---

# V5 — landscape

The reel's frame shape is a project-level choice, the same tier as the
palette — never per-scene.

```json
{
  "format": "LANDSCAPE",
  "scenes": [ ... ]
}
```

`format` accepts `PORTRAIT` / `LANDSCAPE`, or the synonyms `VERTICAL`/`9:16`
and `HORIZONTAL`/`WIDE`/`16:9`. Omit it and the document's own `width`/`height`
are used to infer it — `1920x1080` is read as landscape without needing the
field spelled out. Omit both and the reel renders portrait, as it always has.

Landscape is not portrait cropped or letterboxed — the whole type system
replans against the new frame's own 1920×1080 proportions, so margins, the
type scale, composition spacing and every semantic size and position resolve
correctly for the wider frame rather than being stretched onto it.

---

# V6 — objects (motion graphics)

A scene may carry `objects` alongside its text. Text is unchanged: `text`,
`elements`, `composition` and `visualStyle` all behave exactly as before, and a
document with no `objects` key is read by exactly the code that read it in V5.

A scene needs **text, `elements`, or `objects`** — a scene made only of
graphics is legal.

```json
{
  "duration": 3,
  "text": "ONE TAP",
  "animation": "PUNCH",
  "background": "BLACK",
  "composition": "TOP_STATEMENT",
  "elements": [{ "text": "ONE TAP", "role": "SECONDARY" }],
  "objects": [
    {
      "id": "card-1",
      "type": "CARD",
      "x": 0.12, "y": 0.32, "width": 0.76, "height": 0.26,
      "surface": { "fill": "#16181B", "radius": 0.09, "shadow": "STRONG" },
      "title": { "text": "Upload your file", "size": 0.04, "weight": 600 },
      "motion": { "enter": "FLOAT_IN", "speed": "MEDIUM" }
    }
  ]
}
```

## Geometry and timing

`x`, `y`, `width`, `height` are **fractions of the parent**, top-left origin —
of the frame for a top-level object, of the container for a child. Values
outside `0..1` bleed off the edge on purpose. Fractions rather than pixels so a
scene composes unchanged in portrait and landscape.

`start` and `duration` are **seconds from the start of the scene**. Omit
`duration` to run to the end of the scene. Never frames.

`layer` sets paint order; negative puts the object *behind* the scene's type.
Without it, objects paint in array order, above the type.

## `type`

| type | carries |
|---|---|
| `SHAPE` | `shape`: `RECTANGLE` `ROUNDED` `CIRCLE` `LINE` |
| `IMAGE` / `LOGO` | `src` (a `public/` path or an http(s) URL), `fit`: `CONTAIN` `COVER` |
| `ICON` | `icon`, `color`, `weight` |
| `CARD` | `title`, `body`, `surface`, `children` |
| `BUTTON` | `label`, `icon`, `surface`, `stateStyles` |
| `CURSOR` | `stops` |
| `GROUP` | `children`, `sequence`, `stagger` |

`ICON` names: `CHECK` `PLUS` `UPLOAD` `DOWNLOAD` `FOLDER` `FILE` `CAMERA`
`SCAN` `SEARCH` `ARROW_RIGHT` `CHEVRON_RIGHT` `CLOSE` `HEART` `STAR` `BELL`
`USER` `LOCK` `PLAY`.

## `motion` — intent, not keyframes

```json
"motion": {
  "enter": "SLIDE_IN", "from": "LEFT", "speed": "FAST", "distance": "MEDIUM",
  "emphasis": "PULSE",
  "exit": "FADE_OUT",
  "delay": 0.3
}
```

- **`enter`** — `FADE_IN` `SLIDE_IN` `RISE_IN` `POP_IN` `SCALE_IN` `REVEAL`
  `FLOAT_IN` `DRAW_IN`
- **`emphasis`** (loops while on screen) — `PULSE` `POP` `SHAKE` `FLOAT`
  `GLOW` `BOUNCE`
- **`exit`** — `FADE_OUT` `SLIDE_OUT` `SCALE_OUT` `SHRINK` `REVEAL_OUT`
- **`speed`** `SLOW` `MEDIUM` `FAST` · **`distance`** `SMALL` `MEDIUM` `LARGE`
  · **`from`/`exitTo`** `LEFT` `RIGHT` `TOP` `BOTTOM`

Each preset is a recipe over several channels at once — `FLOAT_IN` is opacity,
a rise, a slight scale and a blur that burns off early. Do not try to express
one by combining others; pick the name that matches the intent.

`DRAW_IN` strokes an icon on. It is only meaningful on `ICON` and `LINE`.

## `surface` — how something is painted

`fill`, `stroke`, `strokeWidth`, `radius` (fraction of the shorter side, `0..0.5`),
`shadow` (`NONE` `SOFT` `MEDIUM` `STRONG`), `glow` (`NONE` `LOW` `MEDIUM` `HIGH`),
`glowColor`, `blur`.

## States and the cursor

A `BUTTON` declares how it looks in each state; only the states that differ
need an entry.

```json
{
  "id": "button-1", "type": "BUTTON",
  "label": { "text": "Upload" },
  "surface": { "fill": "#F2F4F2", "radius": 0.5 },
  "stateStyles": {
    "SUCCESS": { "fill": "#4ADE6A", "glow": "MEDIUM",
                 "label": { "text": "Uploaded" } }
  }
}
```

A cursor moves between `stops` and can drive another object's state on arrival:

```json
{
  "id": "pointer-1", "type": "CURSOR",
  "stops": [
    { "x": 0.85, "y": 0.92, "at": 0 },
    { "x": 0.50, "y": 0.67, "at": 1.6, "travel": 0.8, "path": "ARC" },
    { "x": 0.50, "y": 0.67, "at": 1.9, "action": "CLICK",
      "targetId": "button-1", "targetState": "SUCCESS" }
  ]
}
```

States: `DEFAULT` `HOVER` `PRESSED` `ACTIVE` `SUCCESS` `ERROR`.
Actions: `CLICK` `PRESS` `RELEASE` `HOVER`. Paths: `STRAIGHT` `ARC` `CURVE`.

## Groups and sequencing

`CARD` and `GROUP` hold `children`, addressed in **the container's** fractions.
Moving the container moves them all; each may still animate on its own.

`"sequence"`: `TOGETHER` (default) · `AFTER` (each waits for the previous
entrance) · `STAGGER` with `"stagger": 0.15` seconds between children.

## V6 prompt block

> Scenes may contain `objects` as well as text. Use objects for anything that
> is not type: cards, buttons, icons, shapes, images, a cursor.
>
> Position everything in fractions of the frame (`0..1`, top-left origin) and
> time everything in seconds from the start of the scene.
>
> Choose motion by intent — `POP_IN`, `FLOAT_IN`, `SLIDE_IN` with a `from`
> edge — never by describing coordinates or curves. Add `emphasis` only when
> something should keep moving after it arrives.
>
> To show an interaction: give the button a `SUCCESS` entry in `stateStyles`,
> add a `CURSOR` whose last stop has `"action": "CLICK"` and points at the
> button's `id`, and let a `CHECK` icon `DRAW_IN` just after.
>
> Keep typography doing the talking. Objects support the words; they do not
> replace them.
