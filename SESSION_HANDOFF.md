# Session handoff — Flarent Motion Engine

Dense, cold-start reference. `README.md` explains how the engine works day to
day and `templates/SCHEMA.md` is the JSON contract; this file is for what a
fresh session needs that the code and those documents don't say — decisions,
current state, and traps already paid for.

---

## 1. Goal

Flarent Motion Engine turns a `Scene[]` data model into a 1080×1920 (or
1920×1080) H.264 reel — no fixed template, no fixed duration. It began as a
kinetic-typography engine; this session took it through **V6** (2D motion
graphics: shapes, cards, buttons, icons, a cursor, with intent-based motion
rather than keyframes) and **V7** (one global audio track on the project clock),
plus per-word colour, canvas dragging of type, and fixes to
split-into-elements. Long-term target is `script → AI → Scene[] → engine →
MP4`, with `templates/SCHEMA.md` as the seam the AI layer plugs into.

The standing constraint across every version: **extend, never replace.** Each
brief has said so explicitly, and the architecture is now shaped by it.

---

## 2. Decisions made (and why)

**Reference-measured, not eyeballed.** Every constant in `typography.ts`,
`easing.ts`, `composition.ts`, `visualStyle.ts`, `splashMotion.ts` came from
frame-by-frame measurement of a source video, cited where it is used. Don't
"clean up" a magic number without re-measuring.

**Three parallel planner paths, deliberately not unified.** `planSingle`
(plain-text scenes) and `planComposed` (`scene.elements`) were kept separate in
V3 so pre-V3 reels render byte-for-byte through the original code. V6 added a
*third*, `planObjects`, for graphics. Sharing a planner between type and
rounded rectangles would mean one carrying the other's concepts. Do not merge
them.

**Project-level things render as siblings of `<Series>`, never inside it.**
The static overlay (V4) and the audio track (V7) both sit outside the scene
sequence in `compositions/FlarentVideo.tsx`. Inside, they would inherit a
scene's lifetime and be remounted at every boundary — which for audio is
exactly "the music restarts each scene".

**Audio sync is structural, not maintained.** Remotion's `<Audio>` lives inside
the composition, so the editor's `<Player>` and the headless `renderMedia` drive
it from the clock they already draw scenes with. There is deliberately no
`HTMLAudioElement` in the editor and no play button on the audio panel — a
second playback surface would be a second clock. If audio ever needs to be
"kept in sync", something has been built in the wrong place.

**V6 objects are a second list beside `elements`, not a replacement.** Text
keeps its specialised model (roles, semantic sizes, compositions, visual
styles); a scene with no `objects` key takes literally the code path it took
before. Proof rather than assertion: all 14 pre-V6 reels have byte-identical
schema fingerprints.

**Object motion is intent, resolved to channels.** `utils/objectMotion.ts` holds
recipes over opacity/x/y/scale/rotation/blur. `FLOAT_IN` is not "translate up";
it is a flat opacity curve, a rise on a settling curve, a slight scale and a
blur that burns off early. The UI exposes the name; the engine owns the curves.
Everything is a pure function of the frame — no accumulation, no rAF, no DOM
measurement, because those look right in preview and export as nothing.

**One project constructor, four doors.** `utils/project.ts` is the only place a
`Project` is made (scratch / JSON / template / resumed auto-save). The editor
takes one and cannot tell which door was used. Add a function there, never a
branch inside the editor.

**Extract and Import are inverses, and the gate enforces it.**
`serialiseProject`/`parseFlarentScript` round-trip; unknown enum values are
errors, never silent substitutions; validation is all-or-nothing.

**The sample document is generated, never hand-written.**
`data/sampleProject.ts` builds real scenes and runs them through the real
serialiser, so it cannot be invalid and picks up new fields automatically. A
hand-maintained sample drifts the first time a field is added.

**Branch, then fast-forward — no PRs.** One committer. Topic branch → `--ff-only`
into `main` → push → delete branch. Linear history, `main` the only long-lived
branch. The user has said plainly they don't read git; flat history is a
deliberate kindness, not an aesthetic. Don't introduce PR ceremony or `--no-ff`
without asking.

---

## 3. Current state

`npm run check` (tsc + regression gate) and `npm run build` both clean.
**Git: on `main`, clean, in sync with `origin/main` at `a09042a`** —
everything below is pushed to `github.com/shibamsinha/flarentmotionengine`.

**Working and verified by measuring real renders, not by reading previews:**

- V1–V5 unchanged. All 16 Reference Reels and 3 templates fingerprint
  identically after every change this session.
- V6 objects render through Remotion: card, button, cursor arc + click driving a
  button to a glowing success state, checkmark drawing on, staggered progress
  rows — with kinetic typography in the same frame.
- V7 audio exports correctly. Verified by FFT of the exported stream: a source
  trim of 10–20s from a tone file produced 440 Hz at project t=0 switching to
  550 Hz at t=5s — trim, timeline mapping and zero drift in one measurement.
- Word colour, silent export, canvas dragging of type — all measured in the
  render (see §6 for the placement caveat that turned out not to be a bug).
- Split-into-elements now preserves layout (ink boxes within 1–2px) and chains
  each element's delay to the previous one's *finish*.

**Not built (all V6 brief items, none blocking):** composition presets (§25),
path-based movement (§20), animated backgrounds (§22), and dragging *nested*
objects — a child's coordinates are container-relative, so a drag needs to walk
ancestor transforms.

**Known imperfection:** after splitting, the lead-in element writes about one
word slower than it did unsplit. An element paces its words across its own
window, so five words with the whole scene to fill run slower than the same five
as the first five of eight. Exact parity needs a per-element duration field —
a schema addition, not a fix.

**Deferred by the user, not forgotten:** hosting. They were asked and said not
now. §5 holds the constraints already worked out.

---

## 4. Files touched

Only what this session added or changed. Everything else is V1–V5 and untouched.

**Startup flow (V5)**
- `src/App.tsx` — reduced to the phase router (`splash → start → editor`).
- `src/Editor.tsx` — **new**; the former `App` body, extracted verbatim.
- `src/types/project.ts`, `src/utils/project.ts` — the `Project` type and its
  only constructors.
- `src/utils/splashMotion.ts` — measured ratios, fitted beziers, timings.
- `src/components/start/{Splash,StartScreen,TemplateBrowser,ParticleField}.tsx`
  — launch sequence, three-door start screen, Reference Reels browser, and the
  ported flarent.online constellation background.
- `src/data/sampleProject.ts` — the generated sample offered on the import view.

**V6 objects**
- `src/types/object.ts` — the object model.
- `src/utils/objectMotion.ts` — 9 entrances, 6 emphases, 5 exits as channel
  recipes.
- `src/utils/planObjects.ts` — seconds→frames, group sequencing, cursor actions
  folded into their target's state timeline.
- `src/utils/importObjects.ts` — objects across the JSON boundary.
- `src/components/motion/ObjectLayer.tsx`, `objects/icons.tsx` — the renderer
  and 18 stroked icons.
- `src/components/editor/{ObjectList,ObjectInspector,ObjectStage}.tsx` — list,
  kind-specific inspector, canvas box.
- `src/data/objects.ts` — object constructors and immutable tree edits.
- `src/data/v6Demos.ts` — `v6-mixed` and `v6-objects` demo reels.

**V7 audio**
- `src/types/audio.ts` — `ProjectAudio`; source range and timeline position are
  separate fields on purpose.
- `src/components/motion/AudioTrack.tsx` — Remotion `<Audio>` in the composition.
- `src/utils/waveform.ts` — cheap duration read, expensive cached peaks.
- `src/components/editor/AudioControls.tsx` — import, waveform trim, volume,
  fades, missing-asset state.

**Word colour / placement**
- `src/components/editor/WordColors.tsx` — per-word picker.
- `src/components/editor/TextStage.tsx` — drag type on the canvas.
- `src/components/motion/primitives.tsx` — `recolour()` at the glyph seam;
  `ENTER_SECONDS` as the single source of entrance length.
- `src/utils/plan.ts` — `mergeWordColors`, `wordColors` on `PlannedElement`.

**Shared / modified**
- `src/types/scene.ts` — `objects`, `audio`, `wordColors` added; all optional.
- `src/utils/importScript.ts` — reads/writes objects, audio, word colours;
  scene-empty rule widened to "text, elements **or** objects".
- `src/utils/persistence.ts` — `sanitiseAudio`; audio in the saved payload.
- `src/compositions/{FlarentVideo,SceneRenderer}.tsx` — audio track; object
  layer split around the type by `layer` sign.
- `src/components/editor/ElementEditor.tsx` — `seedElements` rewritten to seed
  from the real plan; `cascadeDelays` + "Re-time cascade" button.
- `server/render-server.mjs` — `?kind=audio` uploads (64MB cap), audio in the
  render body. **Does not hot-reload.**
- `scripts/baseline.mjs`, `test/baseline.json` — the regression gate.
- `scripts/{favicon,splash-wordmark}.mjs`, `public/favicon*`,
  `public/brand/splash-wordmark.png`, `index.html` — brand assets.
- `src/index.css` — all new UI; appended, no existing rule modified.
- `README.md`, `templates/SCHEMA.md` — V5/V6/V7 sections and AI prompt blocks.

---

## 5. Next steps (in order)

1. **Watch the V6/V7 demos and give taste feedback.** Open `V6 typography +
   motion graphics` from Reference Reels. Plumbing is done; the motion curves,
   glow strengths and default sizes are opinions nobody has judged yet.
2. **Composition presets (V6 §25)** — "UI Card Intro", "Button Interaction" etc.
   The building blocks all exist; this is assembling them.
3. **Per-element duration**, if exact split fidelity matters. Schema addition;
   would close the §3 imperfection.
4. **Nested object dragging** — needs ancestor-transform walking in
   `ObjectStage`.
5. **The README has no "Hosting" section** but `netlify.toml`'s header comment
   tells the reader to go read one. Either write it (§3 of the old handoff has
   the material, summarised below) or drop the reference.
6. **Typeface + brand black hex** — outstanding since V1. It is why the splash
   wordmark ships as a bitmap. Needs the actual files from the user.
7. **The AI layer.** `templates/SCHEMA.md` now covers V6 objects and V7 audio
   with prompt blocks; nothing has been built against it.

**Hosting, when it is reopened** (deferred by the user, don't raise unprompted):
two processes, not one. `netlify.toml` already deploys the editor only and
404s `/api/*` deliberately. The editor calls `/api/*` as **relative paths**,
resolved in dev only by Vite's proxy — a split deployment needs same-origin or a
configurable base URL. `out/` and `public/uploads/` are local disk. The render
server has **no auth**. Recommendation on record: one always-on container
serving both `dist/` and the API on one origin.

---

## 6. Gotchas

- **`src/index.css` is one flat ~2500-line stylesheet with no scoping, so a new
  rule can silently redefine an old one.** This happened: a `.swatch` added for
  the word-colour picker (22px) overrode the scene list's existing `.swatch`
  (a 9px field dot) and blew the `.scene-row` grid apart across the whole
  editor. Nothing failed — it typechecked, built and rendered. Grep the class
  name before adding CSS, prefer a prefixed name (`.word-swatch`,
  `.object-row`), and audit with:

      python3 -c "
      import re,pathlib
      s=pathlib.Path('src/index.css').read_text(); d={}
      for m in re.finditer(r'(?m)^([^\s@/][^{]*)\{', s):
          d.setdefault(' '.join(m.group(1).split()).rstrip(','),[]).append(s[:m.start()].count(chr(10))+1)
      print({k:v for k,v in d.items() if len(v)>1} or 'no duplicate selectors')"

- **`npm run dev` uses `concurrently -k`, so killing one server kills both.**
  Restarting the render server after editing `render-server.mjs` (which does not
  hot-reload) silently takes Vite down with it. A "vite exited with code 143" is
  a *symptom*; read the `[RENDER]` lines above it. Free both ports with
  `lsof -ti:5173 -ti:5174 | xargs kill`.

- **The Browser pane does not run `requestAnimationFrame` unless it is
  displayed.** Measured: 0 rAF callbacks in 700ms with `document.hidden === false`
  and `visibilityState === "visible"`; screenshots fail with "the pane is not
  displayed, so the page is not compositing frames". This produced a confidently
  wrong conclusion twice — that flarent.online's background was static, then that
  the port of it was. **Canvas contents not changing proves nothing here.**
  Verify animation logic in Node (see the exported `Particle` in
  `ParticleField.tsx`, which exists for that), or ask the user to show the pane.

- **DOM layout metrics read 0 in the pane's JS context.**
  `getBoundingClientRect`, `offsetWidth` and `getComputedStyle` all return
  zeroes. Verify geometry by measuring rendered screenshots or by deriving from
  the CSS, not by querying the DOM.

- **`planScene` needs a DOM** (`measureText` from `@remotion/layout-utils`), so
  it cannot run in plain Node. The regression gate therefore fingerprints the
  JSON schema and the timeline, not pixels. Layout regressions still need a
  render diff — and against a *same-code two-run* baseline, never a historical
  file, because the renderer has a ~1.5–2px noise floor.

- **`ffmpeg`'s `cropdetect` lies about small bright objects.** It reported the
  splash mark as 76×104 (aspect 0.73) when NumPy on the extracted frames gave
  116×116 (aspect 1.000, matching `logo.png`'s 1.039). An hour went into "why
  doesn't the logo asset match?" For ink geometry, decode frames and threshold
  them yourself.

- **Extract → import is not byte-identical, and that is not a bug.** The
  importer snaps durations onto the frame grid, so `reference` and `19s` (scenes
  authored at 0.85/0.75/0.65s, none a whole frame at 30fps) come back as
  0.867/0.733/0.667s. They render identically and it settles after one pass. The
  gate tests **idempotence**, not byte-identity, and records the affected scenes
  under `durationsSnapped`.

- **Scene ids come from `Date.now()`**, so any fingerprint must normalise them
  or it compares two runs and always fails.

- **`ElementEditor`'s per-element cards render before the scene-level ones in
  DOM order.** A naive `querySelector('.style-card')` grabs the element
  override, not the scene default. Target by label text, not position.

- **Object labels need `fontFamily` explicitly.** Without it they fall back to
  the UA serif in the headless render — which is what they did, next to type set
  in Flarent Grotesk. Only visible by looking at the MP4, not the preview.

- **`CANVAS` in `utils/timing.ts` means "portrait / the default", not "the
  active frame".** Any new sizing function must take an explicit `canvas`
  parameter. Measurement caches are keyed on frame width for the same reason.

- **`Scene.style` is the animation; `Scene.visualStyle` is the paint.** Same
  split on `PlannedElement.style` vs `.visual`. Don't conflate.

- **Frame 0 of every reel is blank by design** — entrance opacity starts at 0.

- **Never redraw the brand logo from memory.** `public/brand/logo.png` is the
  source of truth; `scripts/brand-crop.mjs` and `scripts/favicon.mjs` derive from
  it. An earlier hand-drawn SVG approximation was explicitly rejected.

- **This file can go stale.** An earlier version claimed `git init` was still
  outstanding when the repo already had a remote. Verify environment state
  directly (`git status`, `curl` the health endpoints) rather than trusting it.
