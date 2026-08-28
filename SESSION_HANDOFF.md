# Session handoff — Flarent Motion Engine

Dense, cold-start reference. Read `README.md` for how the engine works day to
day; this file is for what a fresh session needs that the code and README
don't say — decisions, current state, and traps already found.

---

## 1. Goal

Flarent Motion Engine is a scene-based kinetic typography engine (React + TS +
Vite + Remotion) that turns a `Scene[]` data model into a 1080×1920 (or now
1920×1080) H.264 reel — no fixed template, no fixed duration. This arc of
sessions took it from the V2 baseline (motion: transitions, blur, easing)
through **V3** (composition: roles, hierarchy, semantic sizing/positioning,
oversized/clipped type), **V4** (independent visual styles — solid / outline /
gradient / split, orthogonal to animation), editor polish (static overlay,
Extract JSON, the real brand logo, an editable project title), and
**landscape** as a second project-level output format. Long-term target:
`script → AI → Scene[] → engine → MP4`, with the import/export JSON schema
(`templates/SCHEMA.md`) as the seam a future AI Motion Director plugs into.

---

## 2. Decisions made (and why)

**Reference-measured, not eyeballed.** Every constant in `typography.ts`,
`easing.ts`, `composition.ts`, `visualStyle.ts` came from frame-by-frame
measurement of a reference video (ink bounding boxes, centroids, colour
sampling), cited in a comment where it's used. Don't "clean up" a magic number
without re-measuring.

**Layout lives in the planner, motion lives in the components** (`plan.ts` vs
`components/motion/*.tsx`), and V4 added a third axis on top: **visual style
lives in `StyledText.tsx` alone**. No animation component ever sees a colour,
stroke or gradient — `TypeBlock` builds the already-painted glyph and hands it
to `renderWord(word, line, glyph)`. This is *the* rule that keeps 5 animations
× 4 styles from becoming 20 components; don't let style logic leak into
`Massive.tsx`/`Slide.tsx`/etc.

**V3 kept two separate planner paths** (`planSingle` for plain-text scenes,
`planComposed` for `scene.elements`) rather than unifying them, specifically so
every pre-V3 reel keeps rendering through the *original* code path, byte-for-
byte. This is why V2 regression checks always pass — don't merge the two paths
"for cleanliness."

**Static overlay renders as a sibling of `<Series>`, not inside it**
(`compositions/FlarentVideo.tsx`) — the only way to guarantee it can't inherit
any scene's motion or get re-mounted at a scene boundary.

**Extract and Import share one schema.** `serialiseProject`/`parseFlarentScript`
in `utils/importScript.ts` are exact inverses — no separate "export format" to
keep in sync. Import validation is all-or-nothing; unknown enum values are
errors, never silently substituted.

**Landscape uses an explicit `canvas: VideoConfig` parameter everywhere, never
a mutable "current format" global.** Reason: Remotion's `calculateMetadata`
step and the actual frame-rendering pass are not guaranteed to share JS module
state (can be different browser pages/realms in `renderMedia`) — a global
would be correct in the editor's `<Player>` and silently wrong on export.
Inside the Remotion tree, `format` resolves once via `calculateFlarentMetadata`
and every descendant reads it back through `useVideoConfig()`. Outside the
tree (the editor's drag overlays — `BoxStage`/`ImageStage`/`OverlayStage`),
`App.tsx` computes `canvas` once from `format` state and passes it down
explicitly. **Do not "simplify" this back to a global.**

**`BoxStage.tsx` is the one shared drag/resize primitive** for both a scene's
free-placed picture and the project's static overlay — same pointer math
(capture, corner-aspect-lock, scale-from-preview-size), different `rect`/`min`/
`onChange`. A canvas *selection* model (`App.canvasTarget`) sits on top: click
to select (shows handles), click empty canvas or Escape to deselect — an
unselected box is an invisible hit-area, not permanently-visible furniture.

**The brand logo is the user's real asset**, not a recreation. Early in this
arc I hand-drew an SVG approximation of it; the user explicitly rejected that.
`public/brand/logo.png` (2000×2000, mostly transparent padding) is the source
of truth; `scripts/brand-crop.mjs` regenerates the two on-screen crops
(`logo-lockup.png`, `logo-mark.png`) from it. **Never redraw the logo from
memory again — if the asset is missing, ask for the file.**

**Branch before committing to `main`.** Standing practice, not user-specified:
this repo already had one commit (`114c380`, all of V1–V4) on `main` with a
real GitHub remote before this arc started. All of this arc's work landed on
branch `landscape-format` (commit `53e36c9`), not on `main`, and was not
pushed.

---

## 3. Current state

`tsc --noEmit` and `vite build` both clean as of the last check. Everything
described above is implemented and was **verified by rendering actual MP4s and
measuring pixels** (ffprobe dimensions/frame counts, alpha-weighted centroid
diffs, ink-colour histograms) — not by reading the preview and assuming.
Nothing is known-broken or half-finished.

**Git**: on branch `landscape-format`, working tree clean, one commit ahead of
`main` (which still points at `114c380`). `origin/main` exists
(`github.com/shibamsinha/flarentmotionengine.git`) but **nothing from this
branch has been pushed** — the user asked to commit, not push or merge.

**Hosting**: not addressed yet — the user's next question, interrupted to
request this handoff instead. Key fact for that conversation: this is **two
processes**, not one. `npm run dev` runs a Vite dev server (the editor UI,
port 5173) *and* `server/render-server.mjs` (a Node process that drives
`@remotion/renderer` + headless Chrome to produce MP4s, port 5174) via
`concurrently`. A static host (Netlify/Vercel/etc.) can serve the built editor
UI, but MP4 export needs a long-lived Node process with a real Chrome binary
available — not a typical serverless fit. That split is the first thing to
raise with the user before recommending a host.

**Dev server is not persistent across tool-call turns in this environment** —
it stopped at least once mid-arc and had to be restarted manually for browser
verification. Don't assume it's running; check `curl localhost:5174/api/health`
or just try to load `localhost:5173` before debugging "why is nothing loading."

---

## 4. Files touched (this arc: V3 → V4 → overlay/extract/logo → landscape)

**Data model**
- `src/types/scene.ts` — `TextRole`, `SizePreset`, `PositionPreset`,
  `CompositionPreset`, `SceneElement` (V3); `VisualStyleName`/`VisualStyleConfig`
  refs, `Scene.visualStyle`/`styleConfig` (V4); `OverlayImage`,
  `Scene.hideOverlay` (overlay); `CanvasFormat`, `FlarentVideoProps.format`
  (landscape).

**Planner / utils**
- `src/utils/composition.ts` — new in V3: roles, semantic sizes, position
  anchors, composition presets, flow layout + collision `separate()`. V4 added
  nothing here (style is separate). Landscape: every geometry function takes
  `canvas` now.
- `src/utils/plan.ts` — the planner. V3 added `planComposed`/`ResolvedElement`/
  `PlannedElement` alongside the original `planSingle`. V4 added `mergeVisual`
  (element-over-scene style inheritance) and `PlannedElement.visual`. Landscape:
  `planScene`'s 5th param, threaded through every helper underneath.
- `src/utils/visualStyle.ts` — **new in V4**. Style registry, colour tokens,
  `resolveStyle` (config → theme-resolved paint), `styleCss` (the actual CSS,
  shared between renderer and editor previews so they can't drift).
- `src/utils/typography.ts` — V3: nothing structural. Landscape:
  `SIDE_MARGIN`/`KICKER_MIN`/`KICKER_MAX`/`RAPID_BASE_SIZE` became functions
  (`sideMargin()` etc.) of a `canvas` param; `fitToWidth`/`widthOf` cache keys
  now include `canvas.width`.
- `src/utils/imageLayout.ts`, `src/utils/transition.ts` — landscape: `canvas`
  param threaded through (`composeImage`, `exitSpecFor`, `planTransition`).
- `src/utils/timing.ts` — landscape: `CANVAS_FORMATS`, `canvasFor()`,
  `DEFAULT_FORMAT`. `CANVAS` still exists, now means "portrait / the default,"
  not "the only frame."
- `src/utils/importScript.ts` — V4: `visualStyle`/`styleConfig` read + written
  on scenes and elements. Overlay: document-level `overlay`, per-scene
  `hideOverlay`. Landscape: `format` (with synonyms) read, inferred from
  width/height if absent, written back by `serialiseProject`.
- `src/utils/persistence.ts` — sanitisers extended in step with each feature
  above (`visualStyle`/`styleConfig`, `overlay`, `format`).

**Motion / rendering**
- `src/components/motion/StyledText.tsx` — **new in V4**. The one place a
  glyph is painted; `LetterSplit` for SPLIT's letter-band mode.
- `src/components/motion/primitives.tsx` — `TypeBlock`/`StyleBlock` gained
  `visual`/`renderWord`'s third `glyph` arg (V4); `MotionProps.canvas`
  (landscape, required — `SceneRenderer` always supplies it).
- `src/components/motion/{Massive,Slide}.tsx` — the two styles with
  frame-relative throws; now read `canvas` from props instead of a module
  `CANVAS` constant. Punch/Stack/Rapid needed no change (no frame-relative
  math).
- `src/components/motion/Outgoing.tsx` — V4: exits per-piece with each
  element's own visual style (`exitPiecesOf`). Landscape: `canvas` prop.
- `src/components/motion/OverlayLayer.tsx` — **new**. The static overlay
  itself; `overlayRect()` now takes `canvas`.
- `src/compositions/{FlarentVideo,SceneRenderer}.tsx` — `SceneRenderer` reads
  `useVideoConfig()` once and builds the `canvas` object passed to `planScene`
  and every style component; `calculateFlarentMetadata` resolves `format` →
  real width/height.

**Editor**
- `src/App.tsx` — owns `format` (+ `canvasTarget` selection state from the
  overlay work); topbar format switch; wires `canvas` down to every consumer
  that needs it outside the Remotion tree.
- `src/components/editor/Logo.tsx` — **new**. Renders `public/brand/*.png`.
- `src/components/editor/{OverlayControls,OverlayStage}.tsx`,
  `src/components/motion/OverlayLayer.tsx` — the static-overlay feature.
- `src/components/editor/{BoxStage,ImageStage}.tsx` — `BoxStage` extracted as
  the shared drag primitive; `ImageStage` thinned to just the picture-specific
  bits.
- `src/components/editor/ExtractPanel.tsx` — **new**. "Extract JSON," a
  first-class button (moved out of the old Import sheet's buried copy button).
- `src/components/editor/{ElementEditor,VisualStyleControls}.tsx` —
  `VisualStyleControls` is **new** (V4 style picker with live-rendered
  previews via `styleCss`); `ElementEditor` wires it in per-element.
- `src/components/editor/{SceneEditor,ImageControls,ExportBar,VideoPreview}.tsx`
  — threaded `canvas`/`format` through as each feature needed it.
- `src/index.css` — style-picker swatches/cards, drag-stage handle colours
  (image vs. overlay), format-switch glyph, logo lockup sizing.

**Server / scripts / docs**
- `server/render-server.mjs` — accepts `format` in the render POST body,
  forwards it in `inputProps`. **This file does not hot-reload** — see
  Gotchas.
- `scripts/brand-crop.mjs` — **new**. Regenerates the two logo crops from
  `public/brand/logo.png`.
- `templates/SCHEMA.md`, `README.md` — sections added for V3, V4, overlay,
  Extract JSON, logo, landscape. Read these before re-explaining any of the
  above from scratch.

---

## 5. Next steps (in order)

1. **Hosting** — the question this handoff interrupted. Needs a real
   conversation with the user: split hosting (static UI + a persistent render
   server), a Remotion Lambda/Cloud Run-style serverless render path, or
   something else — see §3 for the constraint that shapes the answer.
2. Decide whether/when to push `landscape-format` to `origin` and merge to
   `main`. Currently local-only.
3. Typeface + brand black hex — flagged as outstanding since the V1 handoff,
   never resolved. Needs the actual values/files from the user.
4. Watch the V4/landscape reels and tune taste dials — gradient colours,
   outline stroke-weight default, `ROLE_*` constants, composition `gap`s.
   Plumbing is done; these are opinions, not architecture.
5. The AI layer itself. `templates/SCHEMA.md` is AI-ready (V4 + landscape
   prompt blocks included); nothing has been built against it yet.

---

## 6. Gotchas

- **This file (SESSION_HANDOFF.md) can go stale** — an earlier version of it
  claimed "git init" was still outstanding when the repo already had a commit
  and a GitHub remote. Verify repo/environment state directly (`git status`,
  `git log`, `curl` the health endpoints) rather than trusting a prior
  handoff's claims about it.
- **The render server does not hot-reload.** Editing `server/render-server.mjs`
  and then exporting without restarting `npm run dev` silently runs the old
  code — this actually happened mid-arc (the static overlay was missing from
  an export because the server process predated the feature). Always restart
  after touching that file, and verify with `curl localhost:5174/api/health`.
- **`ElementEditor`'s per-element style/animation cards render before the
  scene-level ones in DOM order.** A naive `querySelector('.style-card')`
  grabs the element override, not the scene default — produced a false "bug"
  mid-session. Target controls by their label text/container, not position.
- **The renderer has an inherent noise floor between identical renders** —
  measured by rendering the same input twice: up to ~1.5–2px of alpha-weighted
  centroid drift, ~20/430 frames with >0.7px bbox delta, from H.264/antialiasing/
  SVG-filter rasterization jitter, not layout bugs. V4's gradient/stroke SVG
  filters raised this floor slightly versus pre-V4. **When checking for a
  regression, diff against a same-code two-run baseline, never a historical
  file** — otherwise you'll chase phantom regressions (did exactly this once,
  resolved by re-measuring).
- **`CANVAS` in `utils/timing.ts` now means "portrait / the default," not
  "the active frame."** Any new sizing/layout function must take an explicit
  `canvas` parameter — never read `CANVAS.width`/`height` and assume it's
  correct for the current project.
- **Measurement caches are keyed on frame width now** (`fitToWidth`/`widthOf`
  in `typography.ts`). Any new per-frame-dependent measurement needs the same
  treatment or you'll get portrait-cached values leaking into a landscape
  render (or vice versa) within one process's lifetime.
- **`Scene.style` is the animation; `Scene.visualStyle` is the paint.** Same
  split on `PlannedElement.style` vs `PlannedElement.visual`. Don't conflate
  when reading or extending either type.
- **Frame 0 of every reel is blank by design** — entrance opacity starts at 0.
  Not a bug; don't "fix" it without deliberately changing V2's entrance timing
  (which would ripple through every style).
- **`.gitignore` already correctly excludes** `node_modules`, `dist`, render
  outputs in `out/`, and `public/uploads/*` — confirmed empirically before the
  last commit; `git add -A` is safe in this repo.
