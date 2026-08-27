# Flarent Motion Engine — V4

A scene-based kinetic typography engine. You write text, break it into scenes,
give each scene an animation style and a length, and the engine renders a
1080×1920 / 30fps H.264 reel. There is no fixed template and no fixed duration:
the film is exactly as long as its scenes add up to.

V1 built the engine. V2 was about **how type moves** — transitions, motion blur,
easing. V3 is about **how type exists on the screen**: roles, hierarchy,
semantic sizes and positions, composition presets, and typography that runs past
the frame on purpose. V4 is about **how type looks** — solid, outline, gradient
and split treatments chosen per scene, entirely independently of how it moves.

The test V3 is built against is the *pause test* — stop the reel anywhere and the
frame should read as a designed composition. V4 adds a second: the same
animation with a different visual style should look like a different film, and
the same style across different animations should still look like one.

```bash
npm install
npm run dev
```

`http://localhost:5173` — editor and preview.
`http://localhost:5174` — render server (started by the same command).

Both ports are fixed on purpose. If either is already taken — usually a
previous `npm run dev` still running — the process says so and stops rather
than quietly moving to another port:

```bash
lsof -ti:5173 -ti:5174 | xargs kill
```

Or move both: `FLARENT_APP_PORT=5273 FLARENT_RENDER_PORT=5274 npm run dev`.

---

## What the reference told us

`reference/Video-48028.mp4` (720×1280, 23.976fps, 7.34s) was measured frame by
frame — per-frame ink bounding boxes, alpha-weighted centroids, edge sharpness
and colour histograms — before any animation code was written. The findings are
baked into the engine and cited in the source where they matter.

**Palette** — sampled, not guessed:

| role | value |
| --- | --- |
| cream field | `#EEEEEE` |
| green field | `#13581D` |
| ink on green | `#FFFFFF` |
| ink on cream | `#214E1B` — deliberately deeper than the green field |

See **Palettes** below for the black · cream pair.

**Motion** — the distance between the type and its resting position halves
roughly every frame and settles in about seven, which `cubic-bezier(0.16, 1,
0.3, 1)` reproduces almost exactly. Opacity follows a noticeably *flatter*
curve (measured 0.15 / 0.44 / 0.67 / 0.84 / 0.97 over six frames), so the two
are driven by different easings — `EASE.settle` and `EASE.reveal` in
`src/utils/easing.ts`. Blur burns off first, so a word is readable before it
stops moving.

**Structure** — 16 shots with an accelerating rhythm, 0.83s at the head down to
0.33s at the tail. Entrance animation is used in the first half and *dropped
entirely* in the second: the fast section is pixel-identical within each shot
and cuts the background on every beat. At that tempo the cut is the animation.

**Typography** — hero words fill 80–84% of the frame width; short words all land
on the same ceiling size (~0.385 × frame width), which is why "were", "never"
and "run" match. Support words sit at roughly a quarter of the hero but never
leave a 0.078–0.105 × frame-width band — it is a two-step type scale, not a
pure ratio. Lines are stacked on their ink with a gap of ~0.042 em of the hero.

---

## Architecture

```
src/
  types/scene.ts            Scene, WordAnimation, AnimationStyle — the data model
  utils/
    easing.ts               cubic-bezier solver + one curve per style
    motionBlur.ts           velocity → directional smear
    transition.ts           scene seams: overlap, exits, word continuity
    timing.ts               scene → frame arithmetic; totalFrames lives here
    typography.ts           palettes, font metrics, tracking, size resolution
    imageLayout.ts          picture rect + the band it leaves the type
    persistence.ts          auto-save to localStorage, defensively restored
    importScript.ts         storyboard JSON → validated Scene[] (and back)
    plan.ts                 the planner: Scene → measured, timed composition
    fonts.ts                face loading + render gating
  components/motion/
    Massive.tsx Punch.tsx Stack.tsx Slide.tsx Rapid.tsx
    Outgoing.tsx            the previous scene's type, leaving
    SceneImageLayer.tsx     the picture layer
    primitives.tsx          enterValues(), exitValues(), carryValues(),
                            <MotionSpan>, <TypeBlock>, <StyleBlock>
    registry.ts             style id → component + capabilities
  compositions/
    SceneRenderer.tsx       one scene: plan, field colour, picture, dispatch
    FlarentVideo.tsx        <Series> of scenes + calculateMetadata
  components/editor/        VideoPreview, SceneList, SceneEditor, Timeline,
                            ImageControls, ImageStage, ImportPanel,
                            Transport, ExportBar
  remotion/                 bundle entry for the renderer and Remotion Studio
server/render-server.mjs    POST /api/render → MP4, POST /api/upload → image
```

**Layout lives in the planner, motion lives in the components.** `planScene()`
resolves roles, sizes, line positions and per-word timing; a style component
receives that plan and only decides how things move. That is why adding a style
is one file plus one registry entry.

### Adding an animation style

1. `src/components/motion/NewStyle.tsx` — a component taking `MotionProps`,
   built from `enterValues` / `MotionSpan` / `TypeBlock`.
2. Add it to `MOTION_STYLES` in `registry.ts`.
3. Optionally add a `SIZING.newstyle` entry in `typography.ts`.

The editor, timeline and renderer pick it up with no further changes.

---

## V3 — typography and composition

V2 could say one thing per scene, loudly. V3 can compose a frame.

```
                        V2                        V3
  per scene       one block of text        a list of placed elements
  hierarchy       hero + support           PRIMARY / SECONDARY / EMPHASIS / SUPPORT
  size            per-style, automatic     XS … OVERSIZED, semantic
  position        left / centre / right    17 semantic positions, incl. off-frame
  layout          centred in the band      8 composition presets
  the frame       a container              a clipping window
```

A scene with no `elements` plans through the V2 path untouched — verified by
rendering the V2 preset before and after and diffing every frame (see
**Verifying**). Everything below is additive.

### Roles

`PRIMARY` · `SECONDARY` · `EMPHASIS` · `SUPPORT`

A role is what a piece of type is *for*. It supplies a default size, a weight
(900 / 800 / 800 / 700 — the extremes take the extreme faces; a different weight
per role would be a weight salad, not a hierarchy) and an entrance amplitude, so
EMPHASIS moves hardest and SUPPORT barely moves.

Roles are a real hierarchy, not labels. Lower roles are **capped against
whatever dominates the frame** — the four-step generalisation of the measured
two-step scale, where the reference's support line never exceeds roughly a
quarter of its hero however big that hero is. Without it a three-letter SUPPORT
word hits its own ceiling while a long PRIMARY line shrinks to fit, and the
frame reads with its hierarchy inverted. The cap applies only to sizes inherited
from the role; an explicit `size` is the author overruling it on purpose.

### Sizes, and why type is not shrunk to fit

`XS` · `SMALL` · `MEDIUM` · `LARGE` · `HUGE` · `OVERSIZED`

Resolved against the canvas, the font metrics and the length of the text.
`LARGE` lands in the reference's measured hero band (0.84 · W). `HUGE` reaches
the edges. `OVERSIZED` goes past them.

**Overhang shrinks as words get longer.** MASSIVE already establishes the
principle — it bleeds below five characters and stays contained above — and V3
needs the continuous version, because both `MORE` (4) and `CUSTOMERS` (9) are
meant to bleed. The rule that covers both: the shorter the word, the more of it
you can afford to lose.

| at `OVERSIZED` | width | visible |
| --- | --- | --- |
| `MORE` (4 chars) | 1.29 × frame | 77% |
| `CUSTOMERS` (9) | 1.14 × frame | 87% |
| `A BUSINESS PLAN` (15) | 1.02 × frame | 98% |

The auto-fit policy is three steps, in this order: take the size that was asked
for, allow the clipping that implies, and intervene **only** when so little of
the ink is left that it has stopped being a word (`minVisible`, 0.5 at
OVERSIZED). Shrink-to-fit is every layout engine's instinct and it is exactly
what makes display typography timid.

One consequence worth knowing: `min` in a size rule is capped at the
frame-filling size. A floor exists so pathological input never disappears — it
must never be the reason type runs off the frame. Before that cap, a
fifteen-character line at OVERSIZED was inflated by the floor to 1.36 × frame
width, *more* overhang than a four-letter word, inverting the whole curve.

### Positions and compositions

Seventeen semantic positions — the nine-point grid, four `EDGE_*` that hang the
ink past an edge, four `OFFSCREEN_*` mainly used as an entrance origin. Nothing
in the authoring surface takes pixels; `x`/`y` exist as an escape hatch and are
the only placements exempt from collision nudging.

Eight compositions — `CENTER`, `LEFT_STACK`, `RIGHT_STACK`, `TOP_STATEMENT`,
`BOTTOM_STATEMENT`, `SPLIT`, `OVERSIZED_CENTER`, `CORNER` — place the elements
that did not name a position, and never override one that did. Elements without
a position flow in **reading order**, so they cannot collide by construction;
`separate()` is a safety net for elements that pinned themselves on top of each
other.

Several compositions reuse the reference's own grammar for which margin an
element hangs from: *support that reads before the dominant element hangs left,
support that reads after hangs right* — the same rule `alignmentForLine` applies
inside a single block.

### The frame is a clipping window

The root `AbsoluteFill` sets `overflow: hidden`. The MP4 would clip anyway — the
canvas is 1080×1920 — but without it the editor's `<Player>` lets a bleeding
word spill over the surrounding UI and the preview stops telling the truth about
the render. Only the root clips; scene layers stay `overflow: visible` so a
motion-blur filter region is not cut off at its own scene boundary.

### What V3 did not add

No new animation styles — the same five, now operating inside compositions
rather than each owning the whole frame. No gradients, glow, shadows, particles
or decoration. Typography is the design.

## V4 — visual styles

`animation` says how type **moves**. `visualStyle` says how it **looks**. Two
fields, two systems, and every one of the twenty combinations is valid.

```
SOLID      one colour, filled              statements, setup, explanation
OUTLINE    hollow letters, drawn as stroke contrast, tension, the quiet beat
GRADIENT   a ramp inside the glyphs        the idea that matters
SPLIT      two treatments in one run       comparisons, two-part ideas
```

### The rule that makes it cheap

No animation component contains a colour. `TypeBlock` builds the word already
painted and hands it to `renderWord(word, line, **glyph**)`; the animation drops
that node inside its `<MotionSpan>` and never learns what it is. Five animations
× four styles is twenty combinations and **zero** extra components — the two
systems meet in exactly one file, `StyledText.tsx`.

Adding a fifth style is: add a name, add an entry to `VISUAL_STYLES`, teach
`styleCss` to paint it. No animation file changes.

### Measured from `Dynamic Text [Kinetic typography].mp4`

| | |
| --- | --- |
| solid ink on light | `#2645B2` — a real blue, not black |
| gradient warm end | `#FC8F25` |
| gradient light middle | `#F3F0F2` |
| gradient cool end | `#89DFF3` |
| outline stroke | 2px on a 38px cap — **3.8% of font size** |

The house gradient runs orange → pink → white → cyan: warm to cool, so it reads
as one move rather than as a rainbow, and it passes through near-white in the
middle so it sits on both fields.

### Theme-aware by default

`{ type: 'solid' }` is a complete style. SOLID and OUTLINE resolve to the ink
that reads on the scene's field — white on green, deep green on cream — without
being told. That default is what keeps four styles inside one design language
rather than making them four unrelated looks.

### Two implementation decisions worth knowing

**Stroke weight is a ratio, not pixels.** A fixed pixel weight gives an
OVERSIZED word a hairline and a caption a slab — Part 9's "disappearing
outlines" in both directions. It is a fraction of the font size, clamped to
1.5–18px.

**The gradient box is the element, not the word.** Each word span gets the ramp
sized to the whole block and offset to its own position, so a gradient runs
continuously across "MORE CUSTOMERS" instead of restarting on every word.

**SPLIT clips rather than re-splits.** Splitting a word into per-character spans
is the obvious approach and the wrong one: it discards kerning and re-flows the
word, so the type would no longer sit where the planner measured it. Instead the
word is drawn once per treatment and each copy clipped to a vertical band — the
typography is untouched and only the paint changes.

### Verified in exported MP4, not preview

`background-clip: text` and `-webkit-text-stroke` both work in Remotion's
headless Chrome — confirmed by rendering and measuring, since Part 8 is right
that the preview is not evidence:

| style | fill ratio | distinct colours | mean saturation |
| --- | --- | --- | --- |
| SOLID | 0.59 | 53 | 39.9 |
| OUTLINE | **0.31** (hollow) | 68 | 21.8 |
| GRADIENT | 0.60 | **238** | 83.1 |
| SPLIT | 0.61 | 169 | 42.6 |

### Style is a rhythm, not a variety show

The V4 reel uses SOLID for the argument, OUTLINE for the turn, and reserves
GRADIENT for exactly two moments — DIFFERENT. and CUSTOMERS. Measured across its
nine scenes, distinct ink colours run 47, 50, 59, **194**, 49, 107, 48, 46,
**220**. Four gradients would have spent the effect before the ending needed it.

## The static overlay

A project-level image that sits over the whole reel — a logo, a watermark, a
plate. It is **not** a `SceneImage` and deliberately shares nothing with one:

|  | scene image | static overlay |
| --- | --- | --- |
| belongs to | one scene | the project |
| animates | on the scene's entrance | never |
| affects the type | carves a band out of the frame | not at all |
| lives in the tree | inside a `Series.Sequence` | a sibling of `<Series>` |

That last row is the feature, not an implementation detail. Rendering it outside
the series is what guarantees no scene's entrance, exit, blur or drift can reach
it, and that it is one element for the whole film rather than one per scene that
re-mounts and re-times at every boundary.

The only thing it reads from the timeline is which scene is on screen, and only
to answer one question: did that scene opt out. `scene.hideOverlay` drops it for
that scene — for the beat where the logo would land on the word, or a full-bleed
photo that wants the frame to itself. That is a hard cut, because it coincides
with a scene change, where the reel already cuts.

**Drag it on the canvas.** Click the overlay to select it, then drag to move or
use the eight handles to resize; corners hold the image's proportions and Shift
breaks them. Press-and-drag does both in one gesture. Clicking empty canvas — or
Escape, for when the object fills the frame — deselects, so the handles are a
selection rather than permanent furniture over the frame you are trying to
judge. Unselected, the box is an invisible hit area that outlines faintly on
hover. The scene picture behaves identically; both share `BoxStage`. The two boxes are different
colours on purpose: grabbing the wrong one is a silent mistake, because the
overlay changes every scene at once. The handles hide during playback, and on a
scene that opted out, where there is nothing on screen to drag.

Both stages share one implementation (`BoxStage`) — capture, corner aspect
locking, minimum sizes and the mapping from screen pixels back through the
preview scale. Two copies of that arithmetic would be two copies to keep in
step.

Numeric controls sit with the palette (it is a property of the reel) as
position, size, opacity and fit, and track the drag live; the per-scene opt-out
sits in the scene panel, where the exception belongs. In a script it is a
document-level `overlay` object and a per-scene `"hideOverlay": true`.

## V2 — motion quality

V2 upgraded three things and nothing else. The five styles, the scene model, the
editor and the export are all V1's.

### Word-to-word transitions

Scene sequences still do not overlap, and `totalFrames` is still exactly
`sum(round(duration × fps))`. Instead, **each scene renders its predecessor's
exit inside its own first few frames**. The timeline is untouched, the frame
count is unchanged, and the seam gets 0.08–0.22s where outgoing and incoming
type coexist.

Doing it this way also settles the colour question: when the field cuts, the
departing word is already on the new field, so it takes the new ink and stays
legible on its way out.

**Word continuity.** Words that appear in both scenes are not exited and
re-entered. The incoming copy is handed the outgoing copy's ink centre and size
and travels from there, so

```
YOU HAVE THE IDEA.   →   YOU HAVE THE WEBSITE.
```

slides "YOU HAVE THE" into its new home while only the hero swaps. Matching is
on the word itself, case- and punctuation-insensitive, first-come first-served.
When anything is carried the block transform is *pinned* and every word animates
for itself — a carried word riding both a block transform and its own carry
would arrive from two places at once.

**Cross-movement.** New incoming words enter from the opposite side of wherever
the outgoing type is heading. Without it, a seam that swaps only the hero leaves
both heroes in the same place and the overlap reads as a double exposure.

**Field cuts stay cuts.** When the field colour changes the exit is capped at
0.1s and its fade leads rather than trails. A field change is the reference's
punctuation; blending across it looks like the words inexplicably changed
colour. Same field ⇒ flowing seam, field change ⇒ hard punctuation. That is the
rhythm, and it is derived rather than configured.

### Motion blur

`src/utils/motionBlur.ts`. Blur is **velocity-derived**, not a timer: the motion
functions are sampled at `frame` and `frame - 1` and the displacement drives the
smear. Held type is pixel sharp and costs nothing; a carried word crossing the
frame streaks.

It is **directional** — an `feGaussianBlur` with a two-axis `stdDeviation`, so a
horizontal slide smears horizontally and keeps its vertical edges crisp. A CSS
`blur()` can only smear round, which reads as "out of focus" rather than "moving
fast". A scale change is converted to an equivalent edge speed so MASSIVE's
scale-up blurs on the same model.

Per-style gain in `BLUR_GAIN` — MASSIVE 1.15, RAPID 0.25, because RAPID is built
from hard cuts and blur there would only muddy a sharp run. Sigma is capped at
18 so a smear never becomes a smudge. Everything is analytic, so the cost is one
extra cubic-bezier evaluation per word: **165 frames render in ~7s**, unchanged
from V1.

### Easing

`src/utils/easing.ts`. One curve per style, so no two resolve the same way:

| curve | used by | shape |
| --- | --- | --- |
| `punchEnter` | PUNCH | quick out, ~6% overshoot — 85 → 106 → 100, crosses 100 once |
| `massiveEnter` | MASSIVE | violent head, long glassy tail |
| `slideEnter` | SLIDE | weighted travel, small overshoot past centre |
| `stackEnter` | STACK | clean and coordinated; no per-word personality |
| `rapidEnter` | RAPID | near-instant |
| `exit` / `exitHard` | exits | ease-*in*, so a word leaves under its own momentum |
| `exitFade` | exits | front-loaded, so two words never compete at half opacity |
| `carry` | shared words | settles a travelling word into its new home |

Exits use ease-in on purpose. An entrance curve decelerates into rest, so
reusing one for an exit makes the word look pulled off screen rather than
leaving.

### Watching it

Two presets in the header: **V2 motion test** (9s) and **V2 motion test — long**
(18s). Both are built so every scene shares a word with the one before it.

---

## The five styles

| style | what it does |
| --- | --- |
| **MASSIVE** | 0.52 → 1.0 scale on an aggressive front-loaded curve. Words of five characters or fewer are sized to 1.08 × the frame so they crop decisively; longer words stay inside. A 2.5% drift keeps the held frame alive. |
| **PUNCH** | 0.90 → 1.0 with a sub-1% overshoot, blur burning off ahead of the move. The workhorse. |
| **STACK** | Words land one at a time into a layout solved for the finished phrase, so nothing already on screen ever shifts. Each build step is a fixed ~0.3s beat and the payoff word holds the remainder. Can cut the field on every beat. |
| **SLIDE** | Enters from any edge on the exponential settle. Vertical throw 6.8% of frame height (the sampled value); horizontal throw is longer and carries more blur. |
| **RAPID** | Motionless staccato beats with the field alternating on each one. Type is set small so a single emphasised beat can drop in at hero scale. |

### Writing scene text

- **Line breaks are honoured.** `People\ndon't\nbuy\nWEBSITES` stacks into four
  lines.
- **On one line**, emphasised words become the hero and the rest become the
  support line. With nothing marked, the last word wins.
- **Reading order is never rearranged.** Words are laid out in the order they
  were typed, so support text that came *before* the hero sits above it and
  support that came *after* sits below. `i'd tattoo` reads "i'd" then "tattoo"
  whichever word you emphasise. There is deliberately no manual override:
  position is a consequence of the sentence, not a setting.

  ```
  i'd tattoo              (emphasis: tattoo)     i'd
                                                 TATTOO

  comparison worth making (emphasis: comparison) COMPARISON
                                                     worth making

  the only comparison     (emphasis: comparison) the only
      worth making                               COMPARISON
                                                     worth making
  ```

  Support above the hero hangs left and arrives with it; support below hangs
  right and lands a beat later — the reference's grammar, now derived rather
  than configured. Emphasising non-adjacent words simply produces more lines;
  no word is ever dropped or moved.
- **RAPID** splits on line breaks, then on sentence punctuation
  (`AI. DESIGN. WEBSITES.`), then on words.

---

## Extracting the current reel

**Extract JSON** in the top bar writes out whatever is on screen — scenes,
elements, compositions, palette overrides, the static image and its per-scene
opt-outs — as the *same* document the importer reads. Download it, copy it, or
just read it.

Deliberately not a separate "export format": one schema in both directions means
what comes out can go straight back in, be handed to someone else, or serve as
the worked example a model is shown when the AI layer arrives. A second format
would be a second thing to keep in step.

Images travel as paths under `public/`, not embedded — move `public/uploads/`
alongside the JSON if you are sending a reel elsewhere.

## Importing a script

**Import JSON** in the header takes a storyboard document — drop a `.json` file
or paste it — validates the whole thing, and loads it as a reel.

```json
{
  "title": "7 Rules for Startups",
  "width": 1080, "height": 1920, "fps": 30,
  "backgroundPalette": { "green": "#12571C", "cream": "#EDEDED" },
  "scenes": [
    {
      "id": "scene-01",
      "duration": 0.65,
      "text": "7 RULES",
      "emphasis": ["7"],
      "animation": "PUNCH",
      "direction": "CENTER",
      "alignment": "CENTER",
      "background": "GREEN",
      "visualNote": "Immediate opening punch."
    }
  ]
}
```

`text` and `duration` are required; `animation` and `background` must be
present and recognised. A bare array of scenes works too. Optional per scene:
`case`, `scale`, `flipBackground`, and `image`. **Copy current reel as JSON**
in the panel emits this exact shape, so the editor is the reference for what
the importer accepts.

Ready-made files:

| file | what it is |
| --- | --- |
| `templates/script-template.json` | A working 5-scene starting point covering all five styles. Import it as-is. |
| `templates/script-full-reference.json` | Every field the importer reads, populated. |
| `templates/SCHEMA.md` | Field-by-field reference, plus a prompt block to hand a model. |

**Validation is all or nothing.** Every problem in the document is collected
and reported together, and a document with any error changes nothing on screen
— a half-imported reel is worse than none. Unknown enum values are errors
rather than silent substitutions: `"animation": "PUCNH"` becoming PUNCH would
surface much later, in the render.

Four translation decisions worth knowing:

- **Multi-word emphasis is split into words.** Storyboards write phrases
  (`"emphasis": ["EXACT WEEK"]`); the engine marks words. Adjacent emphasised
  words then form one hero line — which is what the author meant.
- **`direction: "CENTER"` / `"NONE"` means no travel.** It is accepted and
  dropped; SLIDE falls back to its default and the other styles ignore
  direction anyway. A SLIDE that asks for CENTER gets a warning.
- **Durations are snapped to the frame grid cumulatively.** Rounding each
  duration on its own accumulates error — a 0.35s beat is 10.5 frames, and 42
  of them drift a reel by nearly half a second. Rounding the *cumulative* time
  pins every boundary to the authored timeline instead, so a 25.6s script lands
  on exactly 768 frames. `start` is read and checked against the running total,
  but the engine always derives timing from durations.
- **Imported text keeps its case** (`as-typed`), so a script written in caps
  renders in caps. Set `"case": "lower"` per scene for the reference's
  lowercase voice.

`visualNote` is carried through onto the scene and shown in the editor. It is
never rendered — it exists so the reasoning behind a scene survives the trip in.

`width` / `height` / `fps` are checked and warned about; the engine renders at
1080×1920 / 30fps regardless. `backgroundPalette` overrides the field colours
for the project, and ink is contrast-checked against any override so an unusual
colour cannot produce unreadable type.

Import loads the reel ready to preview — **Export MP4** is then one click.

## Editor chrome

The top bar carries what the reel **is** — the mark, its editable title, the
preset picker, the palette, and the running scene/second/frame count. The bottom
bar carries what you can **do** to it: transport, Import JSON, Extract JSON,
Reset, and Export MP4. Splitting it that way is what keeps the top bar from
filling up every time a project-level action is added.

The title is edited in place — it reads as a label until you click it. It
travels with the project into the auto-save, the extracted JSON and the export
filename.

The logo is the supplied brand asset. `public/brand/logo.png` is the source of
truth — a 2000x2000 export that is mostly empty canvas — and
`scripts/brand-crop.mjs` trims it to its ink twice: the full lockup, and the
mark on its own, both at 3x the on-screen height so they stay crisp on a retina
display without shipping 174 KB into a 22px-tall bar. Re-run that script if the
asset is ever replaced. CSS swaps the lockup for the mark below 1220px rather
than measuring the window in JS.

## Editing

**Auto-save.** The project — scenes, palette, field colours, title, selection —
is mirrored into `localStorage` on a 400ms debounce and restored on load. It is
also flushed on `visibilitychange` and `pagehide`, because a backgrounded tab
can be evicted before a debounce timer fires. The pill next to the export
button shows the state. **Reset** in the header discards the save and reloads
the demo reel. A payload from an older build, or a corrupted one, is discarded
rather than crashing the editor into a blank screen.

**Scrubbing.** The timeline is a scrubber: click or drag anywhere on it to land
on that exact frame, and the scene under the playhead selects itself so the
controls always show what is on screen. Hovering previews the timecode.

| control | key |
| --- | --- |
| play / pause | `Space` |
| ± 1 frame | `←` `→` |
| ± 10 frames | `Shift` + `←` `→` |
| previous / next scene | `↑` `↓` |
| start / end | `Home` `End` |

Shortcuts are suppressed while a text field has focus, so space still types a
space.

## Palettes

A palette is a **pair** of fields — one dark, one light — that the reel cuts
between. It is project-level rather than per-scene because "flip the field"
(RAPID's alternating beats, STACK's build) needs an unambiguous partner for
cream: on its own, cream cannot know whether to cut to green or to black.

| palette | dark field | light field | ink on cream |
| --- | --- | --- | --- |
| `forest` — Green · Cream | `#13581D` | `#EEEEEE` | `#214E1B` |
| `ink` — Black · Cream | `#0F0F0F` | `#EEEEEE` | `#121212` |

The switch in the header re-skins the whole reel: cream stays cream (it is the
light half of both pairs) and every dark scene re-points, so the rhythm of the
cuts survives and only the identity changes.

Black is `#0F0F0F` rather than `#000000` on purpose — a pure-black field this
large bands visibly under H.264, and it reads harsher next to the cream than
the pair deserves. Ink on black is the cream itself rather than white, which is
the same move the reference makes on the light field. **If Flarent's brand black
is a specific value, change `FIELDS.black` and `PALETTES.ink.creamInk` in
`src/utils/typography.ts` — those two constants are the only place either
appears.**

Scene fields are stored as literal names (`green` / `cream` / `black`), so a
reel can deliberately mix green and black scenes; the palette only decides what
cream flips *to* and what colour type takes on cream.

## Images

Per scene, optional, and the type always composes around the picture rather
than landing on it by accident.

| placement | what it does |
| --- | --- |
| **Full** | Edge to edge with the type over it. A flat tint of the scene's own field colour keeps the words legible — not a generic dark gradient, so the frame stays on-palette. |
| **Panel** | An inset plate on the safe margin, top or bottom, with adjustable height. The type takes the band left over. |
| **Split** | The picture owns half the frame full-bleed; the type owns the other half. |
| **Free** | Any box, anywhere. Drag the picture in the preview to move it and pull a handle to resize — corners keep its proportions, `Shift` stretches. X / Y / W / H are also editable as percentages, and `Fit to aspect`, `Centre` and `Fill frame` are one click. `contain` letterboxes instead of cropping, and the picture can sit over the type rather than under it. |

Pictures get the same motion grammar as the type — the house settle, blur
burning off first, and a 1.8% hold drift — rather than a slow Ken Burns pan,
which would fight the reel's cut-driven rhythm. Under RAPID the image cuts hard,
because everything in RAPID cuts hard.

Two safeguards worth knowing about:

- **Type is refitted to the band the picture leaves.** Sizing is width-driven,
  so a hero can easily come out taller than the room a 72% panel leaves. The
  planner re-lays the block until the ink fits, shrinking the support-line
  clamp along with the hero (shrinking only the hero never converges).
- **Focus X / Y** set the crop's focal point, so a subject off to one side
  survives the 9:16 crop.
- **Dragging a preset converts it to Free**, seeded from exactly where the
  preset had it — so nothing jumps under the cursor. The three presets stay as
  one-click art direction; Free is there when you want to place it yourself.

Uploads go to `public/uploads/` and are referenced by path, not inlined into
the scene data — a couple of base64 photos would blow past any sane request
limit. Remotion copies `public/` into the render bundle, so the headless render
reads exactly the same bytes as the preview. Files are content-addressed, so
re-uploading the same picture reuses one file. JPEG, PNG, WebP, AVIF and GIF,
up to 24MB.

An absolute `http(s)` URL also works in `image.src`, but it needs the network at
render time — uploads are the reliable path.

## Variable length

Nothing anywhere assumes a duration. The composition asks Remotion to compute
its own length from the props:

```ts
durationInFrames = scenes.reduce((n, s) => n + Math.round(s.duration * fps), 0)
```

Frames are rounded per scene and then summed, so the timeline never drifts from
what actually renders. The length presets in the header are there to prove it —
they produce exactly 150 / 240 / 570 / 900 frames (5.00s / 8.00s / 19.00s /
30.00s), verified against the exported MP4s.

## Export

**Export MP4** posts the scene list to the render server, which bundles the
composition and drives `@remotion/renderer`. Output lands in `out/` and is
offered as a download: H.264 High profile, 1080×1920, yuv420p, 30fps, CRF 17,
`x264Preset: slow` — ready for Reels / TikTok / Shorts.

The first export downloads a headless Chrome build (once, a few hundred MB) and
webpack-bundles the composition. Later exports reuse both; the bundle is
invalidated automatically when anything under `src/` changes.

## Typeface

Inter, self-hosted from `public/fonts` so the preview and the headless render
use identical bytes. It is referenced everywhere by the internal family name
**Flarent Grotesk**, so swapping it is two steps:

1. Drop new `.woff2` files into `public/fonts/`.
2. Update `FONT_FACES` and `FONT_METRICS` in `src/utils/typography.ts`.

`FONT_METRICS` matters — ink-accurate line stacking and optical centring are
computed from the ascender/descender/cap/x-height ratios, so a new face needs
its real numbers.

## Where the AI layer plugs in

```
script → AI → storyboard JSON → parseFlarentScript() → Scene[] → MP4
```

The seam already exists and is already wired up: **Import JSON** is that arrow.
A model that emits the storyboard document above — where to split, which words
to emphasise, which style, how long, when to cut the field — gets the measured
layout, the timing and the renderer for free, and gets told precisely what it
got wrong when it emits something the engine cannot read.

Nothing in the engine assumes scenes were typed by a human, and no AI
dependency is installed.

## Notes

- `npm run studio` opens Remotion Studio against the same composition.
- `npm run typecheck` type-checks without emitting.
- Remotion is free for individuals and companies of up to three people; larger
  companies need a company licence (see remotion.dev/license). Worth settling
  before this ships internally.
