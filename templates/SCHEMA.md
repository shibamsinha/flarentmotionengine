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

---

# V7 — audio

A document may carry one `audio` block. It is **document-level, beside
`scenes`** — never inside a scene. The track plays on the project clock, so
re-timing, adding or removing scenes moves the visuals underneath it and leaves
the audio where it is.

Projects without `audio` are unchanged in every respect.

```json
{
  "title": "…",
  "scenes": [ … ],
  "audio": {
    "src": "uploads/track.mp3",
    "name": "track.mp3",
    "sourceDuration": 180,
    "sourceStart": 88.2,
    "sourceEnd": 107.6,
    "timelineStart": 0,
    "volume": 0.9,
    "fadeIn": 0.5,
    "fadeOut": 1
  }
}
```

## Two ranges, and they are different things

| | means |
|---|---|
| `sourceStart` / `sourceEnd` | which part of the **file** to use |
| `timelineStart` | where in the **video** that part begins |

Selecting 1:28–1:47 of a song and placing it at 0s of the video is
`sourceStart: 88.2, sourceEnd: 107.6, timelineStart: 0`. Moving the clip later
changes only `timelineStart`; the trim is untouched.

All values are **seconds**.

## Fields

- `src` — a `public/` path (what the upload endpoint returns) or an http(s) URL
- `name`, `sourceDuration` — for the editor's display; ignored when rendering
- `volume` — `0`–`1`, applied in the preview and the export alike
- `muted` — silences without discarding `volume`
- `fadeIn` / `fadeOut` — seconds, measured from the clip's own start and end
- `loop` — `false` by default; music is never looped to fill a longer video
  unless asked

## Length

The video's duration always comes from its scenes. Audio never changes it:

- **audio longer than the video** — the extra is not heard
- **audio shorter than the video** — it stops and the video carries on
- nothing is ever time-stretched

## Missing files

`src` is a reference, not embedded data. A project opened where the file is not
available keeps its audio settings, reports the missing asset, and still
previews and exports — silently.

## V7 prompt block

> A project may have one `audio` block beside `scenes`. Never put audio on a
> scene.
>
> `sourceStart`/`sourceEnd` choose the part of the file; `timelineStart` places
> it in the video. All seconds.
>
> Keep the selection no longer than the video unless there is a reason — the
> excess is not heard. Use `fadeIn`/`fadeOut` of around 0.5–1s when a song
> starts or ends mid-phrase.

---

# Word colour and free placement

## `wordColors`

Colour individual words without changing how they are painted otherwise. Valid
on a **scene** and on an **element**; the element's entries win.

```json
{
  "text": "RED GREEN BLUE",
  "wordColors": { "red": "#FF2D2D", "green": "#22FF66", "blue": "#3D7BFF" }
}
```

Keys are matched **case-insensitively and without surrounding punctuation**, so
a rule for `customers` colours `CUSTOMERS.` too. Matching is by word, not by
position — re-typing the line around a coloured word keeps its colour, and a
word that appears twice is coloured in both places.

Values are any CSS colour.

How a colour lands depends on the word's visual style, so that the style still
reads as itself:

| style | result |
|---|---|
| `SOLID` | the fill becomes the colour |
| `OUTLINE` | the stroke becomes the colour; it stays an outline |
| `GRADIENT` | collapses to a solid in that colour |
| `SPLIT` | every part takes the colour |

`wordColors` is separate from `visualStyle`: a style is how a whole element is
painted, this is one word inside it.

## Free placement — `x` / `y`

An element with both `x` and `y` is pinned there. They place the element's **ink
centre** as fractions of the frame, top-left origin, and an element placed this
way is exempt from the composition's flow and from collision nudging.

```json
{ "text": "CORNER", "role": "SUPPORT", "size": "SMALL", "x": 0.25, "y": 0.2 }
```

Set both or neither — one alone is ignored. Values outside `0..1` are legal and
put the type partly or wholly off the frame, which is the point of them.

In the editor this is a drag: every element in a composed scene has a box on the
canvas, and moving it writes `x`/`y`. A plain-text scene has no elements to
address, so use **Compose · split into elements** first — that is also how a
single word becomes independently draggable, since a word is just a small
element.

---

# V8 — expressiveness

Five additions. **Every one is optional**, so a document that uses none of them
parses and renders exactly as it did before, and the reference reels fingerprint
identically.

## `animation: "NONE"` — a genuine hold

A sixth animation style, alongside `MASSIVE`, `PUNCH`, `STACK`, `SLIDE` and
`RAPID`. It is a real no-motion path, not a very fast one: the identity
transform on every frame, fully opaque from frame 0, with no seam overlap at
either end.

```json
{ "id": "s1", "duration": 0.23, "text": "held", "animation": "NONE" }
```

`STATIC` and `HOLD` are accepted as spellings of the same thing.

Use it when the *cut* carries the rhythm — a held card, a static line over a
changing field, a hard cut between two statements. Everything else in the engine
animates, and before V8 there was no way to say "don't".

Note that `NONE` is the one style whose scene is **not** blank on frame 0. Every
other style starts at zero opacity, which is why "frame 0 is blank" is a
documented property of the engine elsewhere in this file.

## `enterFrames` — an entrance measured in frames

Valid on a scene (a default for its elements) and on an element (which wins).
A whole number of frames, at least 1.

```json
{ "duration": 0.23, "enterFrames": 2, "text": "fast" }
```

Each style has a measured entrance length that is right for the pacing it was
designed at — and wrong at the extremes. A seven-frame scene under `PUNCH`
spends most of its life still arriving, which makes fast cutting impossible.
`enterFrames` overrides the *length* while leaving the *curve* alone: the same
easing, the same channels, the same planner, evaluated over a shorter window.
Opacity and blur scale with it, so a two-frame entrance really is over in two
frames rather than fading for another eight.

It is **not** a keyframe. It says how long, never what happens in between.

An entrance longer than its scene is clamped to fit rather than overrunning.

## `fit` — an exact width, guaranteed not to clip

Valid on a scene and on an element. Overrides `size` entirely.

```json
{ "text": "consistency", "fit": { "mode": "WIDTH", "maxWidth": 0.88 } }
```

A bare number is accepted as shorthand: `"fit": 0.88`.

The size presets are a *scale* — six art-directed steps, each with its own
bleed policy, deliberately length-aware. `fit` is the opposite: an exact share
of the frame whatever the length. The ink is measured to land on `maxWidth` and
stops there, so it never bleeds past the frame — which also means it turns the
bleed off, because bleeding is what a preset does and not what was asked for.
`HUGE` and `OVERSIZED` are unaffected and still run past the edges.

`scale` may shrink fitted text but never grow it, so the guarantee holds.

## `fontRole` — the accent face

Valid on a scene and on an element. `PRIMARY` (the house grotesk) or `ACCENT`
(a serif italic). Also accepts `SANS`, `SERIF` and `ITALIC` as spellings.

```json
{ "text": "beats", "fontRole": "ACCENT" }
```

Exactly two faces, named semantically, and no more. There is no font picker, no
URL, no upload path — the accent stack is built from faces the renderer already
has, so it cannot fail to load mid-render. One controlled contrast is what
professional kinetic typography actually uses; a font manager is a different
product.

Measurement follows the face, so accent text is sized and positioned with the
serif's own metrics rather than the grotesk's.

## `inkPalette` and `accentColor` — arbitrary project colours

Document level, beside the existing `backgroundPalette`.

```json
{
  "backgroundPalette": { "green": "#1A0DCC" },
  "inkPalette":        { "green": "#FFFFFF" },
  "accentColor":       "#00A8FF"
}
```

`backgroundPalette` (unchanged since V1) sets the **ground**; `inkPalette` sets
the **type on it**; `accentColor` is one project-wide accent that graphic
objects read.

The two behave deliberately differently. A background override still has its ink
*derived* automatically to stay readable — the safety net that keeps an imported
script legible when it drops in a mid-tone. An ink override is honoured
**exactly**, with no contrast substitution, because silently overriding a colour
someone chose would make the control untrustworthy.

Both are keyed by field name, so a scene still says which field it is on and the
project decides what that field looks like. That is what keeps a palette a
palette rather than fifty separate decisions.

A malformed colour is a warning and is ignored; it costs that colour, not the
import.

The palette *name* (`forest` / `ink`) remains derived from whether any scene
uses a black field, and is still not stored.

## One constant changed

`MIN_SCENE_DURATION` dropped from **0.15s to one frame (1/30s)**. It was a bound
on an editor control, never a measured value — and at 0.15s any scene shorter
than five frames was silently clamped, which made frame-accurate hard cutting
impossible. The real floor is arithmetic: a scene cannot be shorter than the one
frame a sequence needs to mount.

No existing reel or template was affected; all still fingerprint identically.

---

# V8.2 — kinetic expressiveness

Three more additions, all optional, all backward compatible.

## `exit` and `exitFrames` — leaving as its own decision

Valid on a scene; `exit` is also valid on an element (which wins).

```json
{ "text": "leaving", "animation": "PUNCH", "exit": "SLIDE", "exitFrames": 5 }
```

Exits already happened — a scene's type left in the manner of the style it
arrived in — but the choice was implied and unchangeable. `exit` separates the
two, so a line can punch in and slide out.

`exit: "NONE"` removes the exit entirely: no outgoing type is drawn at the seam
and the boundary is a genuine hard cut, not a short dissolve. Combined with
`animation: "NONE"` all four corners are expressible:

| `animation` | `exit` | Result |
|---|---|---|
| `PUNCH` | `PUNCH` | enter → hold → exit |
| `PUNCH` | `NONE` | enter → hold → cut |
| `NONE` | `PUNCH` | cut → hold → exit |
| `NONE` | `NONE` | cut → hold → cut |

`exit` defaults to the element's own `animation`, then the scene's `style` —
which is exactly what every pre-V8.2 project already did.

`exitFrames` overrides the per-style overlap length. It is still bounded by a
third of the *incoming* scene: a seam that eats the next scene is a bug however
deliberately it was asked for.

## `stagger` — words entering one after another

Valid on a scene (a default for its elements) and on an element.

```json
{ "text": "one two three four", "stagger": { "type": "WORD", "delayFrames": 2 } }
```

A bare number is accepted as shorthand: `"stagger": 2`.

The engine already understood words — it lays them out, colours them and
promotes them individually. Timing was the one axis that stopped at the element:
words arrived together, or on `STACK`'s fixed build beat, and there was no way
to say "two frames apart".

`order` is `FORWARD` (reading order, the default and never serialised) or
`REVERSE`. Reversing changes the *reveal*, not the sentence — per-word colour
and emphasis keep addressing the same words.

An explicit stagger wins over the style's own word timing, including `STACK`'s.
A spacing that would run past the end of the scene is clamped rather than
scheduling words off the end.

This is **not** a keyframe track. It is one number and a direction, which the
planner resolves — the same shape `stagger` already has on object groups.

## `backgroundMotion` — a field that changes while the type holds

Scene level.

```json
{
  "text": "hold",
  "animation": "NONE",
  "backgroundMotion": { "mode": "ALTERNATE", "everyFrames": 4, "times": 6 }
}
```

Flarent could already cut the field *between* scenes, and `RAPID`/`STACK` cut it
on their own internal beats. What it could not do was hold one piece of type
still while the field strobed underneath — previously only expressible by
duplicating the scene once per flip, which makes the timeline unreadable and the
text impossible to edit in one place.

The field alternates between the scene's own background and its palette partner,
held for `everyFrames` frames at a time. The type is untouched: it occupies
identical pixels across a flip, and only the ink re-derives so it stays readable
on the new ground.

`times` bounds the number of flips; omitted, it runs to the end of the scene.
Resolution is integer division on the frame number, so it is deterministic and a
scrub matches a playthrough exactly.

An explicit `backgroundMotion` overrides the style's own field cutting — a scene
that says "alternate every 4 frames" has replaced `RAPID`'s per-beat flip, not
asked for both at once.

---

# V8.3 — the phrase build

**This adds no schema.** `buildPhraseScenes` (`src/data/phraseBuild.ts`) is a
*constructor*: one sentence in, ordinary `Scene[]` out, assembled from the same
`blankScene` and `element` an author would use by hand.

That is the design constraint rather than an implementation detail. There is no
phrase-build field on a scene, no flag, no back-reference to the builder, and no
renderer path only it can take. Once the scenes exist nothing downstream can tell
them from hand-made ones, which is what keeps them editable — the build is a
faster way to *start*, not a mode to work inside.

```
buildPhraseScenes({ sentence: "discipline beats motivation, every single day",
                    totalFrames: 120 })

→ "discipline beats motivation,"   52 frames   PUNCH
  "every single"                   40 frames   PUNCH
  "day"                            28 frames   MASSIVE, emphasised, oversized
```

What it decides, and how to override each:

| Decision | Default | Override |
|---|---|---|
| Where phrases break | punctuation, then ~3 words | `phrases` |
| Cut lengths | `pacing` across `totalFrames` | `framesPerPhrase` |
| Pace | `accelerate` — each card shorter | `pacing: even \| decelerate` |
| Final word | its own display card, removed from the phrase before it | `finalWordEmphasis: false` |
| Word reveal | 2-frame stagger | `staggerFrames` |

The final word is *moved* rather than duplicated: showing it small in a phrase
and then large on its own reads as a stutter, and the build should read as
arriving at that word.

Frame budgets are honoured exactly — the parts sum to `totalFrames`, with any
rounding remainder given to the longest cards so it never flattens the curve.

Both the editor's **Phrase build** panel and the MCP `phrase_build` tool call
this one function.
