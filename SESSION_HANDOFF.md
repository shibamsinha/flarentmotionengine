# Session handoff — Flarent Motion Engine

> **V3 (typography & composition) has since landed.** Section 7 at the bottom
> covers it. Everything below about V1/V2 still holds — the V2 render path is
> unchanged and was verified frame-by-frame against a pre-V3 render.


Written at the end of the build session that took this from empty directory to
V2. Read `README.md` for how the engine works; this file is for what a cold
session needs that the code does not say.

---

## 1. Goal

Build an internal, reusable **kinetic typography engine** — not a generic video
editor — closely modelled on `reference/Video-48028.mp4`: minimal, editorial,
typography-first, fast. React + TypeScript + Vite + Remotion, running locally,
rendering 1080×1920 / 30fps H.264. Video length is always
`sum(scene durations)`; nothing about 7 seconds is baked in anywhere. The
long-term shape is `script → AI → Scene[] → engine → MP4`, and the import path
for that already exists.

---

## 2. Decisions made (and why)

**Reference measured, not eyeballed.** Before writing animation code the
reference was analysed frame by frame — per-frame ink bounding boxes,
alpha-weighted centroids, edge sharpness, colour histograms. Nearly every magic
number in `utils/typography.ts`, `utils/easing.ts` and the style components came
out of that and is cited in a comment where it is used. Do not "clean up" those
constants without re-measuring.

**Position and opacity ride different curves.** The reference's distance-to-rest
halves each frame while opacity resolves almost linearly. Driving both from one
curve is the single clearest tell of a template. Hence `EASE.settle` vs
`EASE.reveal`, and later one entrance curve per style.

**Layout lives in the planner, motion in the components.** `utils/plan.ts`
resolves roles, sizes, line positions, absolute word centres and per-word
timing; a style component only decides how things move. Adding a sixth style is
one file plus one line in `registry.ts`. Keep this seam.

**Sizing is fit-to-width with a per-style ceiling.** Long words shrink to a
target width; short words hit a cap. MASSIVE's cap is *height*-derived
(0.40·H of cap height ≈ 0.98·W) because a one-character word cannot fill the
width — the real limit is how tall a glyph may stand.

**Support-line size is a clamped band, not a ratio.** It tracks the hero at
0.265 but never leaves 0.078–0.105 · W. The reference's support line is really a
second fixed step in a two-size scale; scaling purely off the hero makes the
caption vanish under a long word.

**Reading order is never rearranged.** Words render in typed order; support text
before the hero sits above it, after sits below. There is deliberately **no
manual override** — an earlier `kickerPosition` setting existed and was the
direct cause of a bug where "I'D TATTOO" rendered TATTOO first. Position is a
consequence of the sentence.

**Palette is a *pair*, project-level.** "Flip the field" (RAPID beats, STACK
builds) needs an unambiguous partner for cream, so `forest` (green·cream) and
`ink` (black·cream) are project state while scene fields stay literal names.
Black is `#0F0F0F` not `#000` — pure black bands under H.264 across flat
full-frame areas.

**Import validation is all-or-nothing.** Every problem in a document is
collected and reported together and nothing is applied unless the whole file is
valid. Unknown enum values are errors, not silent fallbacks — a `"PUCNH"` typo
quietly becoming PUNCH would only surface in the render.

**V2 seams do not touch the timeline.** Each scene renders its *predecessor's*
exit inside its own first few frames. No sequence overlaps another, frame count
is untouched, and the departing word is already on the new field so it takes the
new ink and stays legible. `<Series>` stayed; this was the least invasive way to
get visual overlap.

**Field cuts stay cuts.** Same field ⇒ flowing seam (0.11–0.22s). Field change ⇒
exit capped at 0.1s with a leading fade. Blending across a field change reads as
the same words inexplicably changing colour. This is the rhythm rule, derived
from the scenes rather than configured.

**Motion blur is velocity-derived and directional.** Sampling the motion
function at `frame` and `frame − 1` gives displacement; an `feGaussianBlur` with
a two-axis `stdDeviation` smears along the axis of travel. CSS `blur()` can only
smear round, which reads as "out of focus" rather than "moving fast". All
analytic — no re-rendering, no `@remotion/motion-blur` dependency.

---

## 3. Current state

**Everything below is working and was verified by rendering and measuring, not
by assumption.**

- Five styles (MASSIVE / PUNCH / STACK / SLIDE / RAPID), V2 motion quality.
- Editor: scene CRUD, reorder, duration, style, field, alignment, type scale,
  emphasis chips, case. Auto-save to `localStorage` (debounced + flushed on
  `visibilitychange`/`pagehide`). Timeline is a click/drag scrubber; transport
  with frame stepping and keyboard shortcuts.
- Images: `full` / `panel` / `split` presets plus `free` with on-canvas
  drag-and-resize, numeric X/Y/W/H, fit, over/under-type.
- Import JSON with full validation; `templates/` has a working template, a
  full-field reference and `SCHEMA.md` (which ends with a prompt block for
  generating scripts).
- Export MP4 via the local render server. H.264 High, 1080×1920, yuv420p, CRF 17.
- Presets: reference reel, V2 motion test (9s), V2 long (18s), 5s / 8s / 19s /
  30s — all land on exact frame counts (150 / 240 / 570 / 900).

**Nothing is known-broken or half-finished.** `tsc --noEmit` and `vite build`
both clean.

**Not implemented on purpose** (explicitly out of scope): AI generation, any
OpenAI dependency, voiceover, audio, auth, database, deployment.

---

## 4. Files touched

Everything under the project root was created this session. Notable ones:

| path | what it is |
| --- | --- |
| `src/types/scene.ts` | `Scene`, `SceneImage`, `PaletteName`, `WordAnimation` — the data model everything crosses |
| `src/utils/timing.ts` | `CANVAS`, `buildTimeline`, `totalFrames`, `distributeFrames` — all frame arithmetic |
| `src/utils/typography.ts` | Palettes, Inter metrics, tracking, per-style `SIZING`, `fitToWidth`/`widthOf` (both memoised) |
| `src/utils/plan.ts` | The planner. Line splitting, roles, ink-accurate stacking, absolute word centres, per-word timing |
| `src/utils/easing.ts` | Cubic-bezier solver + house curves; V2 added one entrance curve per style and ease-*in* exits |
| `src/utils/motionBlur.ts` | V2. Velocity → two-axis sigma, per-style `BLUR_GAIN`, `MAX_SIGMA` |
| `src/utils/transition.ts` | V2. Seam length per style, exit specs, word matching, cross-movement |
| `src/utils/imageLayout.ts` | Picture rect + the band it leaves the type; every value `finite()`-guarded |
| `src/utils/importScript.ts` | Storyboard JSON → validated `Scene[]`, and `serialiseProject` back out |
| `src/utils/persistence.ts` | Auto-save; restore is defensive and discards anything it cannot trust |
| `src/utils/fonts.ts` | Face loading + `delayRender` gating, module-level singleton |
| `src/components/motion/primitives.tsx` | `enterValues`, `exitValues`, `carryValues`, `MotionSpan`, `TypeBlock`, `StyleBlock` |
| `src/components/motion/{Massive,Punch,Slide}.tsx` | Thin — just their curves, handed to `StyleBlock` |
| `src/components/motion/Stack.tsx` | Own renderer (per-word reveal + background flip helper) |
| `src/components/motion/Rapid.tsx` | Own renderer (motionless beats) |
| `src/components/motion/Outgoing.tsx` | V2. The previous scene's type, leaving |
| `src/components/motion/registry.ts` | style id → component + capabilities |
| `src/compositions/{FlarentVideo,SceneRenderer}.tsx` | `<Series>` + `calculateMetadata`; per-scene plan, field, picture, seam |
| `src/components/editor/*` | The tool UI — `ImageStage` and `Transport` are the V-latest additions |
| `server/render-server.mjs` | `POST /api/render`, `POST /api/upload`, `GET /out/<file>`; bundle cache keyed on `src/` + `public/` mtimes |
| `templates/` | Import template, full-field reference, `SCHEMA.md` |
| `README.md` | Architecture, reference findings, V2 section |

---

## 5. Next steps

Nothing is outstanding. If work resumes, in rough order of value:

1. **Watch the two V2 demo reels** (`out/flarent-v2-motion-test-9s.mp4`,
   `-18s.mp4`, or load the presets) and tune values in `utils/transition.ts`
   (`OVERLAP_SECONDS`, `CROSS_RATIO`, `exitSpecFor`) and `utils/motionBlur.ts`
   (`MAX_SIGMA`, `SPEED_TO_SIGMA`, `BLUR_GAIN`). These are taste dials; the
   plumbing is done.
2. **Typeface.** Inter is ~13% wider than the reference's grotesk, so hero words
   need more width for the same size. If a closer face is licensed, drop the
   `.woff2` files into `public/fonts/` and update `FONT_FACES` + `FONT_METRICS`
   in `utils/typography.ts` — nothing else references a font.
3. **Flarent's real brand black**, if `#0F0F0F` is not it: `FIELDS.black` and
   `PALETTES.ink.creamInk`, two constants, one file.
4. **The AI layer.** The seam exists: a model emits the `templates/SCHEMA.md`
   document, `parseFlarentScript` validates it, done. Nothing in the engine
   assumes a human typed the scenes.
5. **Git.** This is not a repository yet (`git init` never run).
6. **Remotion licensing** — free for individuals and companies up to three
   people; larger companies need a commercial licence. Worth settling before it
   ships internally.

---

## 6. Gotchas

**The render server does not hot-reload.** Vite HMR updates the editor, but
`server/render-server.mjs` is a Node process — after editing it you *must*
restart `npm run dev`. This bit the user twice: uploads 404'd and exports
silently ignored the palette because a stale server was still running.

**Ports 5173 / 5174 are `strictPort`.** Deliberately: Vite used to hop to the
next free port, which is the render server's, and the collision surfaced as a
confusing `EADDRINUSE` crash one process over. Both processes now fail loudly
with the fix in the message. Alternate ports:
`FLARENT_APP_PORT=5273 FLARENT_RENDER_PORT=5274 npm run dev` — use this to run a
second stack for verification without disturbing the user's.

**Verification method that actually found bugs.** Render → `ffmpeg` to PNGs →
NumPy/PIL measure. Background is `frame[5,5]`; ink is `|pixel − bg|.sum(axis=2) >
threshold`. Row-projection segments lines; column ranges isolate a word.
Comparing measured ink widths against the reference's is how the type scale was
calibrated, and per-frame ink coverage is how blank-frame flashes were caught.
Nothing about the motion was judged by reading code.

**Planner sweep.** In the browser, `await import('/src/utils/plan.ts?t=' +
Date.now())` (cache-bust is required or you test stale code), call
`loadFlarentFonts()` first, then brute-force the cross product of styles × texts
× durations × alignments × images × palettes and assert: no NaN, no negative
durations, ink fits its band, and **words laid out === words typed, in order**.
That last assertion is what would have caught the reading-order bug originally.
Tens of thousands of permutations run in seconds.

**Text measurement needs fonts loaded.** `fitText`/`measureText` silently
measure the fallback face otherwise. `SceneRenderer` builds no plan until
`useFontsReady()` is true; the field still paints so there is no flash. Do not
"optimise" that gate away.

**Frame counts must stay deterministic.** `totalFrames` =
`sum(max(1, round(duration × fps)))`. The import path additionally snaps
durations to the grid *cumulatively* (round the running total, not each
duration) — rounding each independently drifted a 25.6s script by 0.43s over 42
scenes. V2 seams were built specifically so they cannot change the frame count.

**Things that did not work, and why:**
- *Cancelling the block transform for carried words* — dividing opacity/scale to
  undo the block motion is numerically fragile. The fix is `StyleBlock`'s
  continuity mode: when anything is carried, the block is *pinned* and every
  word animates for itself.
- *A back-loaded exit fade* — movement-first is right in principle, but two
  half-opaque display words in the same place are mush. `exitFade` is
  front-loaded so one word dominates at every instant.
- *Token cross-movement (0.34 of the exit throw)* — display type fills the
  frame, so a small offset separates nothing. 0.75 is the working value.
- *An effect keyed on `active` to measure the `ImageStage` overlay* — the host
  element mounts when a picture is attached, which is not a change in `active`,
  so scale stayed 0 and the overlay never appeared. It uses a callback ref now.
- *`overflow: hidden` on the image stage* — clipped the resize handles whenever
  the box bled off-frame, which is exactly when you need them.

**`plan.block` is the *first* RAPID beat, not the last.** Anything asking "what
is on screen when this scene ends" must use `exitBlockOf()`.

**macOS.** Remotion warns "your macOS version is older than macOS 15" on Sonoma.
It is noise — rendering works; hundreds of frames were rendered on this machine.

**esbuild's postinstall is gated.** `package.json` carries an `allowScripts`
entry. A fresh `npm install` on another machine may need
`npm approve-scripts esbuild`, or Vite will not start.

**`out/` and `public/uploads/` are gitignored** (with `.gitkeep` files). The user
has their own renders and uploads in there — do not bulk-delete.

**Scratchpad artefacts are gone.** The frame dumps, contact sheets and analysis
scripts lived in the session scratchpad, not the repo. The *findings* are in code
comments and `README.md`; the raw measurements are not recoverable without
re-running the analysis on `reference/Video-48028.mp4`.

---

## 7. V3 — typography & composition

### What changed

A scene can now hold **`elements`**: independently placed, sized, roled and
animated pieces of type. Without that field a scene plans through the V2 code
path untouched, which is the whole compatibility story.

New file: `src/utils/composition.ts` — roles, size rules, position anchors,
composition presets, the flow layout and the collision safety net. It is the
design system; `typography.ts` stayed "font, palette, measurement".

Reshaped: `plan.ts` (two planners — `planSingle` is V2 verbatim, `planComposed`
is new; `BlockLayout` gained `left` and `inkCentre` so placement lives entirely
in the planner), `primitives.tsx` (`StyleBlock` takes a `PlannedElement`, not a
plan; `amplify()` scales a motion's deviation from rest so role amplitude works
for all five styles without touching any of them), `Outgoing.tsx` (exits every
element under its own style), `SceneRenderer` (one style component per element).

`ScenePlan.composition` was renamed `ScenePlan.picture` — it holds the *image*
composition, and V3 needed the word back.

### Decisions worth not re-litigating

**Legacy scenes keep the old planner.** Not a compatibility shim — it is the
only way to guarantee V2 renders unchanged, and it was verified rather than
assumed (see below). Do not "unify" the two planners.

**A role is one scale per element.** No hero/kicker split *inside* an element;
that would put two competing hierarchies in one place, and roles are the
hierarchy now.

**Overhang shrinks as words get longer.** The binary short/long tier MASSIVE
uses cannot serve both `MORE` (4 chars) and `CUSTOMERS` (9), and the brief wants
both oversized. `targetWidth()` is the continuous curve; it is a pure function
so you can argue with it in the console.

**`min` is capped at the frame-filling size.** A floor stops text vanishing; it
must never *cause* a bleed. Before this cap a 15-char line at OVERSIZED was
inflated to 1.36 × frame width — more overhang than a 4-char word. Caught by
measuring, not by reading.

**Type is never shrunk to fit.** `bandRoom` and `minVisible` are the entire
auto-fit policy. Raising them "so everything fits" would undo V3.

**Weight carries hierarchy at the extremes only** (900/800/800/700). One weight
per role reads as a weight salad.

### Verification actually run

- **V2 preserved, measured.** Rendered the V2 preset under V3 and diffed all 270
  frames against `out/flarent-v2-motion-test-9s.mp4`: max channel diff 167, mean
  0.123, 125 frames with ±1px ink-bbox jitter. Then rendered the *same code
  twice*: 163 / 0.117 / 115. The delta is the renderer's own noise floor — H.264
  and font rasterisation are not deterministic here. **Re-run this comparison
  before trusting any future "V2 is fine" claim; a bare diff will never be zero.**
- **Planner sweep**, 1868 permutations (styles × roles × sizes × positions ×
  compositions × durations × pathological text): no NaN, no out-of-range timing,
  words laid out === words typed in order. Elements with empty text are dropped
  by design, so element counts are not preserved for those.
- **Invariants**: zero hierarchy violations across all eight compositions; zero
  clipping at contained sizes; bleeding sizes always bleed.
- **Import**: the brief's own Part 11 JSON parses with zero issues and
  round-trips through `serialiseProject` identically. Bad enums are still errors.

### Gotchas added

**`plan.block` is the *dominant* element's block**, and `plan.style` its style.
Anything scene-wide (field cuts, `stackStepAt`, `rapidBackground`) reads those.
Anything that must cover the whole frame — transitions, exits — must use
`plan.elements` / `exitPiecesOf()`, not `plan.block`.

**A delayed element's words start at `element.delay`, not 0.** Two places test
for this (`StyleBlock`, `Stack`); testing against 0 double-animates the block.

**The root `AbsoluteFill` clips (`overflow: hidden`).** Scene layers must stay
`overflow: visible` or motion-blur filter regions get cut at scene boundaries.

**Frame 0 of any reel is blank** — the first frame of an entrance is at opacity
0. Pre-existing V2 behaviour, identical before and after V3; measured, not
assumed. Fixing it means changing entrance timing, which would change V2.

**Presets can be measured outside the browser** by bundling them:
`npx esbuild src/data/presets.ts --bundle --format=esm --platform=node --outfile=/tmp/p.mjs`
then importing and dumping to JSON for `v2render.mjs`. Text *measurement* still
needs the browser (fonts), so the planner sweep must run there.

### Next steps

1. **Watch the V3 reels** (`V3 composition demo`, `V3 hierarchy test`,
   `V3 oversized test`, `V3 long composition`) and tune taste dials:
   `SIZE_RULES` (bleed / bleedSpan / minVisible), `ROLE_CEILING`, `ROLE_MOTION`,
   and each composition's `gap`. The plumbing is done; these are opinions.
2. **The AI layer.** `templates/SCHEMA.md` now carries a V3 prompt block and
   `templates/script-v3-composition.json` a worked example. The seam is
   unchanged: a model emits the document, `parseFlarentScript` validates it.
3. Still outstanding from V2: typeface, brand black, `git init`, Remotion
   licensing.

---

## 8. The static overlay

A project-level image over the whole reel, with a per-scene opt-out.

**It is rendered as a sibling of `<Series>`, and that placement is the feature.**
Move it inside a sequence and it inherits that scene's lifetime, re-mounts at
every boundary and becomes reachable by scene motion — which is exactly what it
must not be. `OverlayLayer` reads the frame for one reason only: to look up
whether the scene currently on screen set `hideOverlay`.

Not a `SceneImage`, and should not be merged with one. A scene image animates on
the scene's entrance and carves a band out of the frame that the type composes
around; an overlay does neither.

Hiding is a hard cut, not a fade — it coincides with a scene change, where the
reel already cuts, so a fade would be the only soft edge in the film.

Where it lives: `OverlayImage` in `types/scene.ts`, `FlarentVideoProps.overlay`,
`components/motion/OverlayLayer.tsx`, `components/editor/OverlayControls.tsx`
(project panel), the `Static image` toggle in `SceneEditor`, `persistence.ts`,
`importScript.ts` (document-level `overlay`, per-scene `hideOverlay`), and
`server/render-server.mjs`.

**The render server had to change for this**, which means the usual trap applies
with force: `npm run dev` must be restarted or exports silently drop the
overlay. That is precisely how the first verification render came back empty —
the running server was pre-overlay code and ignored the field. To verify without
disturbing a running stack, start a second render server only:
`FLARENT_RENDER_PORT=5274 node server/render-server.mjs`.

**Direct manipulation.** `BoxStage` (`components/editor/BoxStage.tsx`) is the
extracted drag/resize surface; `ImageStage` and `OverlayStage` are thin
adapters over it that differ only in what they read and what they commit. The
pointer arithmetic was duplicated nowhere — if you add a third draggable thing,
extend `BoxStage` rather than copying it. The overlay box is amber and the
picture box green because grabbing the wrong one changes every scene at once.
`OverlayStage` hides on a scene that opted out: handles over something that will
not render would be the editor lying about the output.

Handles are a **selection**, held in `App.canvasTarget` (`'image' | 'overlay' |
null`). Unselected, `BoxStage` still renders its rect as an invisible hit area —
something has to be clickable for the object to be selectable again. A
`.stage-backdrop` under both boxes clears the selection on press, and boxes stop
propagation so a press that lands on one does not immediately clear it. Escape
also clears, which matters for a full-bleed picture where there is no empty
canvas left to click. Playback and removing the overlay clear it too.

Verified by rendering: present on all eight scenes that kept it, absent on the
one that set `hideOverlay`; overlay mask byte-identical across cream-field
scenes and within 0.75% (encoder noise) across five green-field scenes, i.e. it
provably does not move or animate.

---

## 9. Extract JSON

`components/editor/ExtractPanel.tsx`, opened from the top bar. It is a surface
over `serialiseProject` — download, copy, read — not a new format.

**Import and export share one schema on purpose.** Extract emits exactly what
`parseFlarentScript` accepts, so a reel round-trips: verified in the browser on
the V3 demo plus an overlay — 9 scenes, 432 frames, zero issues, compositions,
element roles, the overlay and a `hideOverlay` flag all preserved. If you add a
field to `Scene`, add it to `serialiseElement`/`serialiseProject` *and* the
reader, or the round trip quietly loses it.

`serialiseElement` writes only what was actually set, so AUTO/inherited fields
are absent from the output. That is intended — a document full of defaults
teaches a reader, human or model, that every field is required.

This replaced the old "Copy current reel as JSON" button inside the import
sheet, which was a second path to the same thing and whose `useCallback` deps
were missing `overlay`, so it copied a stale one. `ImportPanel` no longer takes
`scenes` / `title` / `fields` / `overlay` at all.

Note the palette name (`forest` / `ink`) is not written; the reader infers it
from whether any scene uses the `black` field, which is how the editor assigns
it in the first place. That round-trips correctly — do not "fix" it by adding a
`palette` key without checking both sides.

---

## 10. V4 — visual styles

`animation` = how type moves. `visualStyle` = how it looks. Two independent
fields; all twenty combinations valid.

**The architectural rule, and the reason V4 is cheap:** no animation component
contains a colour. `TypeBlock` builds the painted word and passes it as the
third argument to `renderWord(word, line, glyph)`; animations drop it into their
`<MotionSpan>` and never inspect it. The two systems meet only in
`components/motion/StyledText.tsx`. **If you ever find yourself writing
`if (style === 'outline')` inside an animation file, the design has been lost.**

New: `utils/visualStyle.ts` (registry, colour tokens, `resolveStyle`,
`styleCss`), `components/motion/StyledText.tsx`,
`components/editor/VisualStyleControls.tsx`.

### Decisions worth not re-litigating

**Style resolves in `SceneRenderer`, not the planner.** STACK and RAPID cut the
field mid-scene, so an ink-derived colour is a property of the *frame*.
`PlannedElement.visual` holds the merged-but-unresolved config; `resolveStyle`
runs per frame against the live theme.

**Configs merge only when types agree** (`mergeVisual` in `plan.ts`). Inheriting
a scene's gradient stops into an element that asked for OUTLINE would apply
settings that style has no use for.

**Stroke weight is a fraction of font size**, clamped 1.5–18px. Pixels would
give an OVERSIZED word a hairline and a caption a slab. The importer reads a
value > 1 as a percentage and warns.

**The gradient box is the element, not the word** — each word offsets into a
ramp sized to the whole block, so it runs continuously across a phrase.

**SPLIT clips, it does not re-split.** Per-character spans would discard kerning
and re-flow the word off the planner's measurements. Two stacked copies with
`clip-path` bands leave the typography untouched.

**Theme-aware defaults are the coherence mechanism.** `{ type: 'solid' }` is a
complete style. Do not hardcode colours into the demos "to be safe" — that is
what would turn four styles into four unrelated looks.

### Verification actually run

- **All four styles measured in an exported MP4** (not the preview — Part 8 is
  right that they differ). Fill ratio 0.59 / **0.31** / 0.60 / 0.61 and distinct
  colours 53 / 68 / **238** / 169 for solid / outline / gradient / split.
  `background-clip: text` works in Remotion's headless Chrome.
- **V2 preserved.** Same V2 preset rendered under V4 vs the pre-V3 baseline:
  alpha-weighted **centroid moved 0.016px**, total ink changed −0.002%. Bbox-
  differing frames rose (115 → 178) but that is a *threshold* artefact on the
  antialiased top row — x0/x1/y1 deltas are symmetric noise and only y0 is
  biased, by 0.2px. **Use the centroid, not the bbox, for this comparison.**
- **Style rhythm is measurable**: the V4 reel's per-scene distinct-colour counts
  run 47, 50, 59, 194, 49, 107, 48, 46, 220 — the two gradient payoffs stand out
  against everything else.
- **Editor**: scene style and element style are separate controls; clicking the
  element's card left the scene on SOLID and vice versa, and animation stayed
  SLIDE while the style became GRADIENT.

### Gotchas

**The ElementEditor's style cards come before the scene's in the DOM.** A
querySelector that grabs "the first GRADIENT card" hits the element override,
not the scene. Cost me a false bug report; target the block by its label.

**`Scene.style` is the *animation*.** V4 added `Scene.visualStyle`. Do not
rename either — `PlannedElement.style` is likewise the animation, and
`PlannedElement.visual` is the paint.

### Next steps

1. Watch the V4 reels and tune `HOUSE_GRADIENT`, `ROLE_*`, and the outline
   weight default (0.03). Taste dials; plumbing is done.
2. The AI layer. `templates/SCHEMA.md` now carries a V4 prompt block that states
   the animation/style split explicitly and warns against spending GRADIENT.
3. Still outstanding: typeface, brand black, `git init`, Remotion licensing.

---

## 11. Editor chrome

The top bar carries what the reel **is** (logo, editable title, preset, palette,
counts); the bottom bar carries what you can **do** to it (transport, Import
JSON, Extract JSON, Reset, Export MP4). Keep new project-level actions in the
bottom bar — the top bar filling up is what prompted the split.

**The logo is the supplied asset, not a redrawing.** `public/brand/logo.png` is
the source of truth. `scripts/brand-crop.mjs` regenerates `logo-lockup.png`
(448x78) and `logo-mark.png` (81x78) from it — tight alpha crops at 3x the 22px
navbar height. Re-run it if the asset changes; do not hand-edit the crops.

An earlier version of this file used a hand-drawn SVG approximation of the mark.
That was wrong and the user rejected it. If an asset cannot be read from disk,
**ask for it** rather than approximating a brand mark.

The project title is an `<input>` in the top bar, edited in place. It flows into
the auto-save, `serialiseProject`, and the Extract filename.
