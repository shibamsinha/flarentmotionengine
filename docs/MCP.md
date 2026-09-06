# Flarent MCP

An MCP server that lets an AI client operate Flarent Motion Engine — creating
projects, writing and styling type, animating, scoring to music, syncing cuts to
the beat, and rendering — while the existing editor keeps working untouched.

Both surfaces drive the same engine:

```
   Claude ──MCP(stdio)──► Flarent MCP server ─┐
                                              ├─► the same Scene[] model,
   A person ─────────────► Flarent editor ────┘   planners and renderer
```

---

## 1. Architecture

```
              Claude (or any MCP client)
                        │  stdio, JSON-RPC
                        ▼
        ┌───────────────────────────────┐
        │      mcp/server.mjs           │  transport + tool registration
        └───────────────┬───────────────┘
                        │
        ┌───────────────┴───────────────┐
        │          mcp/tools/*          │  intent → document edits
        └───────────────┬───────────────┘
                        │
   ┌────────────────────┼────────────────────┐
   ▼                    ▼                    ▼
mcp/lib/store      mcp/lib/engine     mcp/lib/render-client
   │                    │                    │
   ▼                    ▼                    ▼
.flarent/projects   src/ (the real      server/render-server.mjs
 (Flarent JSON)      engine, via         (Remotion, unchanged)
                     esbuild)
```

Four rules the implementation follows:

1. **No second implementation.** `mcp/lib/engine.mjs` bundles the real
   TypeScript engine (`serialiseProject`, `parseFlarentScript`, `buildTimeline`,
   the motion vocabularies, the object constructors) with esbuild and loads it in
   Node — the same technique `scripts/baseline.mjs` already used. Every enum a
   tool accepts is read from `src/` at startup, so the engine cannot drift from
   what MCP advertises.
2. **No second format.** A stored project is *exactly* `serialiseProject`
   output. See §5.
3. **No second renderer.** `mcp/lib/render-client.mjs` calls the render server
   that already exists.
4. **No motion logic in the tool layer.** Tools write intent (`float-in`,
   `speed: slow`); the planners resolve it to curves at render time.

### Files added

| Path | What it is |
|---|---|
| `mcp/server.mjs` | Entry point; stdio transport; registers every tool |
| `mcp/lib/engine.mjs` | Bridge to the TypeScript engine, with a disk-cached bundle |
| `mcp/lib/store.mjs` | File-backed project store |
| `mcp/lib/schemas.mjs` | Zod vocabulary built from the engine's own enums |
| `mcp/lib/errors.mjs` | Structured error codes and the tool-result envelope |
| `mcp/lib/summary.mjs` | Compact project/scene views |
| `mcp/lib/scenes.mjs` | Lookup and patch helpers |
| `mcp/lib/audio-analysis.mjs` | ffmpeg decode, onset detection, tempo, beats |
| `mcp/lib/assets.mjs` | Media import into `public/uploads` |
| `mcp/lib/idempotency.mjs` | Replay records for retry-sensitive mutations |
| `mcp/lib/render-client.mjs` | Client for the existing render server |
| `mcp/tools/*.mjs` | The nine tool modules |
| `mcp/test/*.test.mjs` | MCP-layer tests on `node:test` |
| `test/*.test.mjs` | Engine schema tests, and render tests that compare real frames |

### Files changed

- **`server/render-server.mjs`** — added `POST /api/still` (single-frame PNG,
  sharing every line of validation with the MP4 path) and
  `DELETE /api/render/:id` (cancel, via Remotion's own `makeCancelSignal`).
  Existing routes and behaviour are unchanged.
- **`package.json`** — added `@modelcontextprotocol/sdk` and `zod`; added the
  `mcp` and `test` scripts; `check` runs typecheck, the regression gate and
  every test.
- **`.gitignore`** — ignores `.flarent/`.

The **V8** work also extended `src/` itself — a sixth animation style, entrance
durations, fit-to-width, an accent face and a project palette. Those are engine
capabilities that the editor and MCP both use, not MCP features; see
`templates/SCHEMA.md`. Every addition is optional, and the regression gate still
reports all 16 Reference Reels and 3 templates fingerprinting identically.

---

## 2. Installing and running

```bash
npm install
```

Start the server on its own (an MCP client normally does this for you):

```bash
npm run mcp
```

It speaks JSON-RPC on stdout and logs to stderr. Rendering additionally needs
the render server:

```bash
npm run dev
```

`npm run dev` starts Vite (the editor, port 5173) and the render server
(port 5174) together. Everything except `render_preview`, `render_video` and
`get_render_*` works without it.

### Verifying it

```bash
npm test
```

139 tests across the MCP layer, the engine schema and real rendered frames. The
rendering suites skip themselves when the render server is down.

---

## 3. Connecting a client

### Claude Desktop

Add to `claude_desktop_config.json` — on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flarent": {
      "command": "node",
      "args": ["/absolute/path/to/Flarent-motion-engine/mcp/server.mjs"]
    }
  }
}
```

Use an absolute path, and restart Claude Desktop afterwards.

### Claude Code

```bash
claude mcp add flarent -- node /absolute/path/to/Flarent-motion-engine/mcp/server.mjs
```

### ChatGPT

**Not supported in v1, and this is not a configuration problem.** ChatGPT's
connectors talk to *remote* MCP servers over HTTP; this server is local stdio
only. Making it work would need the HTTP transport plus a real authentication
system — see §9. Nothing here pretends otherwise.

Any MCP client that launches a local stdio subprocess will work today.

---

## 4. The tools

63 tools. Every one validates its input against an enumerated schema, returns
structured JSON, and reports failures with a machine-readable code.

**Prefer the high-level tools.** `apply_typography_style`, `apply_motion_style`
and `sync_to_beats` take an intent and compute deterministic values. Reach for
the granular tools only to adjust one property.

### Projects
`create_project` · `list_projects` · `get_project` · `update_project` ·
`set_palette` · `duplicate_project` · `delete_project` · `list_templates`

### Scenes
`create_scene` · `get_scene` · `update_scene` · `duplicate_scene` ·
`reorder_scenes` · `delete_scene`

### Bulk and generative
`update_scenes` (different values per scene) · `apply_to_scenes` (one change,
many scenes) · `set_timeline_durations` (a whole cut list) ·
`phrase_build` **← highest leverage**

### Content
`add_text` · `update_text` · `add_shape` · `update_shape` · `remove_element`

### Typography (semantic — see §8)
`apply_typography_style` **← preferred** · `set_text_role` · `set_text_size` ·
`set_text_position` · `set_text_alignment` · `set_text_case` ·
`set_text_composition` · `set_word_colors` · `set_font_property` *(returns
UNSUPPORTED with a pointer to the right tool)*

### Motion
`apply_motion_style` **← preferred** · `animate_element` · `set_entrance` ·
`set_emphasis` · `set_exit` · `set_motion_speed` · `set_motion_distance` ·
`set_motion_direction` · `list_motion_vocabulary`

### Timing
`set_scene_duration` · `set_element_timing` · `scale_timing` · `shift_timing` ·
`inspect_timeline`

### Audio
`add_audio` · `get_audio` · `update_audio` · `trim_audio` ·
`set_audio_offset` · `remove_audio` · `analyze_audio` · `get_beats` ·
`sync_to_beats` **← preferred for re-timing to music**

### Rendering
`render_preview` · `render_contact_sheet` · `render_video` ·
`get_render_status` · `get_render_result` · `cancel_render` ·
`render_server_health`

### Inspection
`inspect_project` · `inspect_scene` · `inspect_audio` · `inspect_animation` ·
`get_flarent_json` · `describe_capabilities`

### Named styles

`apply_typography_style`: `hero`, `statement`, `emphasis`, `kicker`, `body`,
`caption`, `whisper`.

`apply_motion_style`: `aggressive`, `punchy`, `cinematic`, `calm`, `massive`,
`rapid`, `stack`. Each sets both the type's animation and the objects'
entrances, so they agree.

---

## 5. Project storage

```
.flarent/projects/prj_<12 hex>.json
```

**Each file is exactly what the editor's "Extract JSON" button produces.** No
wrapper, no envelope, no MCP fields. Two consequences:

- Anything MCP creates opens in the editor today via **Import JSON**, with no
  editor change. (`get_flarent_json` returns the document to paste.)
- There is no second format to keep in sync — `templates/SCHEMA.md` remains the
  only description of a Flarent project.

Metadata needs no sidecar: the id is the filename, `createdAt`/`updatedAt` are
the file's own timestamps, and the title is the document's own `title`.

Writes are atomic (temp file then rename), and every read is parsed through
`parseFlarentScript`, so a corrupted file fails loudly rather than rendering
something unexpected.

### Two behaviours that will surprise you once

- **Text element ids are positional.** The Flarent format does not store element
  ids, so the importer assigns `<sceneIndex>-<elementIndex>` on load. They are
  stable only while a scene's element order is — adding or removing an element
  renumbers the rest. Re-read them after changing a scene. **Object ids are
  persistent**, because objects *are* serialised with their id.
- **Durations snap to the frame grid.** 0.85s is 25.5 frames at 30fps, so it
  reads back as 0.867s and then holds steady. `MIN_SCENE_DURATION` (0.15s) is a
  UI guard rail rather than a hard floor; cumulative frame rounding can land a
  clamped scene one frame under it.
- **`palette` is read-only.** The engine *infers* it from whether any scene uses
  a black field; it is never stored. Exposing a setter would mean adding a field
  to the document format.

---

## 6. Audio and beat detection

Audio is **project-level**, never scene-level, so scenes can be re-timed under
the music without moving it. Two independent ranges:

| Field | Means |
|---|---|
| `sourceStart` / `sourceEnd` | which part of the **file** plays |
| `timelineStart` | where on the **video's** clock it begins |

`trim_audio` sets the first; `set_audio_offset` sets the second.

### How analysis works

The editor's waveform reader is browser-only (`AudioContext`), so it cannot run
in Node. `mcp/lib/audio-analysis.mjs` is the decode step done with the tools Node
has — **not** a second audio system; the project's audio model is untouched.

```
ffmpeg → mono 22.05kHz PCM
     → STFT (1024 Hann window, 256 hop → 86.1 fps)
     → spectral flux (positive magnitude change)
     → adaptive-threshold onset envelope
     → autocorrelation over 60–200 BPM → period
     → comb-filter phase search → beat grid
```

No new dependency: ffmpeg comes from `@remotion/compositor-*`, with a fallback to
one on `PATH`. Everything after decoding is arithmetic in that one file.
Deterministic — the same file always yields the same numbers — and cached by
content hash.

### How accurate is it?

**Estimated, and labelled as such.** Every result carries `quality: "estimated"`,
a `confidence` (0–1) and the `method` used. Against generated click tracks it
reads 120 BPM as 120.19 and 150 as 149.80. On real music with a clear percussive
pulse it is good; on ambient, rubato or speech it is not, and `bpm` comes back
`null` with a note rather than a fabricated number. **Check `confidence` before
trusting the beats.**

Octave correction (nudging the result into 90–180 BPM) is a heuristic and is one
reason nothing here is presented as ground truth.

### `sync_to_beats`

Modes: `every-beat`, `every-n-beats` (use `n: 4` for bars), `strongest`.
It re-times scene **durations** only — order and content never change — and
reports anything it had to clamp. Pass `preview: true` to see the plan without
writing.

---

## 7. Rendering and visual feedback

- **`render_preview`** renders one frame through the render server's new
  `/api/still` and returns a real PNG as an MCP image block, plus a caption
  saying which scene and second it came from. This closes the loop:

  ```
  create → render_preview → look → modify → render_preview
  ```

  Flarent renders; the **client** does the visual reasoning. There is no
  server-side "critique" — that would be a fabricated capability.

  Frame 0 of every reel is blank by design (entrances start at zero opacity), so
  an unspecified preview takes the midpoint.

- **`render_video`** returns a `jobId` immediately and never blocks. Poll
  `get_render_status` (`starting` → `browser` → `bundling` → `rendering` →
  `done` | `cancelled` | `error`), then `get_render_result`.

- **`cancel_render`** uses Remotion's own cancel signal, so the headless browser
  and the partial file are cleaned up rather than orphaned.

There is no job queue in v1; concurrent renders each drive their own Remotion
render, as they already did for the editor.

---

## 7a. V8 capabilities

Five additions, all optional and all backward compatible. `templates/SCHEMA.md`
has the full contract; this is how to reach them over MCP.

| Capability | How |
|---|---|
| **Custom palette** | `set_palette` with `background` / `ink` / `accent`, keyed by field name. An explicit ink is honoured exactly; leave it out and a readable one is derived. `null` clears back to the house palette. |
| **Static text** | `style: "none"` on `create_scene` / `update_scene` — a genuine hold, verified by rendering identical frames, not a fast animation. |
| **Entrance duration** | `enterFrames` on a scene or a text element. Overrides the style's measured length while keeping its curve; clamped to the scene. |
| **Fit to width** | `fitWidth` (0.05–1) on a scene or element. Exact share of the frame, guaranteed not to clip; overrides the size preset. |
| **Accent face** | `fontRole: "accent"` on a scene or element. |
| **Frame durations** | `durationInFrames` on `create_scene`, `update_scene` and `set_scene_duration`. Exact, and wins over `duration` when both are given. |

The minimum scene length is now **one frame** (was 0.15s), so hard cutting is
expressible: `set_scene_duration({ durationInFrames: 2 })` really is two frames.

**V8.2** adds three more, all on `create_scene` / `update_scene`:

| Capability | How |
|---|---|
| **Text exits** | `exit` (an animation style, or `none` for a hard cut) and `exitFrames`. Defaults to `style`, which is the pre-V8.2 behaviour. All four enter/exit corners are expressible. |
| **Word stagger** | `staggerFrames` plus `staggerOrder` (`forward` / `reverse`). Wins over the style's own word timing. |
| **Background strobe** | `backgroundEveryFrames`, optionally bounded by `backgroundTimes`. The type holds still while the field alternates — one scene, not one per flip. |

```
update_scene { sceneId, style: "punch", exit: "slide", exitFrames: 5,
               staggerFrames: 4, staggerOrder: "reverse" }
update_scene { sceneId, style: "none", exit: "none",
               backgroundEveryFrames: 4, backgroundTimes: 6 }
```

```
set_palette      { background: {green: "#1A0DCC"}, ink: {green: "#FFFFFF"} }
create_scene     { text: "discipline", durationInFrames: 7, style: "none" }
add_text         { text: "discipline", fitWidth: 0.88, fontRole: "accent", enterFrames: 2 }
```

## 7b. Working in bulk, and building from a sentence

Four tools exist so a model does not have to make N near-identical calls.

**`update_scenes`** takes a list of `{ sceneId, ...fields }`. It is one
read-modify-write, and the whole batch is validated before anything is touched —
so either every change lands or none does. A batch naming the same scene twice
is refused, because two entries for one scene have no defined order.

**`apply_to_scenes`** applies the *same* change to many: select by `sceneIds`,
by an index range, or omit both for every scene.

**`set_timeline_durations`** takes a cut list — `framesPerScene: [7, 8, 6, 5, 9]`
— in scene order. The length must match the scene count; a mismatch is refused
rather than partially applied, since a stale list is nearly always a mistake.
`fromIndex` targets a run.

**`phrase_build`** turns one sentence into a run of kinetic-typography scenes:
phrase cards, word-by-word reveal, tightening pace, final word promoted to its
own display card. It replaces six or eight chained calls.

```
phrase_build { sentence: "discipline beats motivation, every single day",
               totalFrames: 120, staggerFrames: 2, replace: true }
→ phrases: ["discipline beats motivation,", "every single"]
  finalWord: "day"   framesPerPhrase: [52, 40, 28]
```

**What it produces is ordinary scenes.** There is no phrase-build marker in the
document, no special renderer path, and nothing locked — `update_scene` edits a
generated scene like any other, and a test asserts exactly that. Every judgement
it makes is overridable: `phrases` for the breaks, `framesPerPhrase` for an exact
cut list, `pacing` for the curve, `finalWordEmphasis` to turn the promotion off.

The same constructor backs the editor's **Phrase build** panel, so neither
surface has its own copy of the logic.

## 7c. Contact sheets

**`render_contact_sheet`** renders several frames and tiles them into one image —
a storyboard, and a far better way to judge a whole reel than a run of
`render_preview` calls.

It defaults to the midpoint of every scene (past the entrance, before any exit,
so a cell shows the scene as it *reads*). Narrow it with `sceneIds` or an index
range, or ask for exact `frames`. Up to 36 cells.

**Only the requested frames are rendered** — a nine-cell sheet of a 600-frame
reel renders nine frames, not 600 — and they go through the same bundle,
composition and validation as `render_preview`, so a cell is not a picture of a
different reel.

The response's `cells` array maps every cell to its scene, frame and position, so
you can refer to a specific cell. Text labels are *not* burned into the image:
there is no font rasteriser in the compositing path, and the metadata is more
useful to a model than pixels of text would be.

## 8. Limitations — what Flarent genuinely cannot do

Call `describe_capabilities` for this list at runtime.

| Not supported | Why, and what to use |
|---|---|
| **Keyframes** | The engine has no keyframe model at all. Motion is intent resolved by the planners. Use `apply_motion_style`, `set_entrance`, `set_emphasis`, `set_exit`. |
| **Video elements** | Scenes hold type, images and graphic objects. There is no video element type, renderer or planner support. |
| **Arbitrary fonts** | Two faces only — `fontRole: PRIMARY` (house grotesk) and `ACCENT` (serif italic). No font picker, no URL loading. Per-property weight, letter-spacing and line-height remain art-directed and unsettable. |
| **Scene-level audio** | Project-level by design, so scenes can be re-timed underneath it. |
| **Transition objects** | There is no transition entity. What plays between two scenes *is* their animation styles — so "a smooth cinematic transition" means `apply_motion_style: cinematic`. |
| **Authentication / multi-user** | Flarent has no accounts, sessions or ownership. See §9. |
| **Remote HTTP MCP** | stdio only in v1. |
| **Images over MCP** | Scene images exist in the engine, but no image tools are exposed in v1. The asset importer that `add_audio` uses would extend to them cleanly. |

Asking for an unsupported property (e.g. `set_font_property`) returns
`UNSUPPORTED_CAPABILITY` with a pointer to the right tool, rather than an
"unknown tool" error that invites retrying variations.

---

## 9. Security model

**The security boundary is the operating system user.** Flarent has no accounts,
sessions, tokens or ownership, and this server does not invent any. It runs as a
local subprocess of whoever started it and can reach exactly the projects that
user can already read. That is a real boundary rather than a pretend one, and it
is why v1 is stdio-only.

The tool layer contains no transport or identity concept, so an authenticated
HTTP transport can be added by changing `mcp/server.mjs` and nothing in
`mcp/tools/`.

### What is not exposed

No shell execution, no SQL, no arbitrary HTTP, no arbitrary filesystem access,
no arbitrary database mutation. Only the capabilities in §4.

### The one filesystem capability, stated exactly

`add_audio` reads a file path. It can only: read **one** file, at a path the
user's own agent supplied, with an extension on a fixed media allow-list, under
a size cap, and copy it to exactly one destination (`public/uploads/`). It cannot
list directories, write elsewhere, or return file contents — **the bytes never
reach the model**, only a duration, a tempo and a hashed filename. Paths that
escape `public/` are rejected.

### Other protections

- **Path traversal**: project ids must match `^prj_[0-9a-f]{12}$`, enforced in
  the tool schema, so a malformed id never reaches the filesystem.
- **Destructive operations require `confirm: true`**: `delete_project`,
  `delete_scene`, `remove_element`, `remove_audio` all refuse without it and say
  what would be lost. Deleting the last scene of a project is refused outright.
  `duplicate_project` is offered as the reversible alternative.
- **Every input is validated** against an enumerated schema before a handler
  runs. Unknown enum values are errors, never silent substitutions.
- **Idempotency**: `create_project`, `create_scene`, `duplicate_scene`,
  `add_text`, `add_shape`, `duplicate_project`, `add_audio` and `render_video`
  accept an `idempotencyKey`. A repeated call returns the first result with
  `replayed: true` instead of creating a duplicate or starting a second render.
  Records are on disk (so they survive a restart) and expire after 24 hours.

---

## 10. Errors

Every failure returns `isError` plus:

```json
{
  "success": false,
  "error": {
    "code": "SCENE_NOT_FOUND",
    "message": "Scene scene_123 is not in this project.",
    "retryable": false,
    "details": { "availableSceneIds": ["scene_1", "scene_2"] }
  }
}
```

| Code | Meaning | Retryable |
|---|---|---|
| `VALIDATION_ERROR` | Arguments were wrong | no — fix and retry |
| `NOT_FOUND` | It does not exist | no |
| `CONFLICT` | State moved underneath you | no — re-read first |
| `UNSUPPORTED_CAPABILITY` | Flarent cannot do this at all | no |
| `CONFIRMATION_REQUIRED` | Destructive; re-send with `confirm: true` | no |
| `SERVICE_UNAVAILABLE` | Render server unreachable | **yes** |
| `RENDER_FAILED` | The render itself failed | no |
| `INTERNAL_ERROR` | A bug here | no |

Errors name what to do next: a missing scene lists the ids that exist; an
unreachable render server names the command that starts it.

---

## 11. Environment variables

| Variable | Default | What it does |
|---|---|---|
| `FLARENT_MCP_HOME` | `<repo>/.flarent` | Where projects, idempotency records and the analysis cache live. Tests set this to a temp directory. |
| `FLARENT_RENDER_PORT` | `5174` | Render server port |
| `FLARENT_RENDER_URL` | `http://localhost:$PORT` | Full render server base URL, if not local |

---

## 12. Example workflow

> "Create a 7-second kinetic typography video around *Consistency beats
> motivation*. Use three scenes. Sync the transitions to the music."

```
create_project              { title, scenes: [3 scenes] }   → projectId
add_text                    ×3, one per scene
apply_typography_style      hero / emphasis / hero
apply_motion_style          cinematic / rapid / massive
scale_timing                { targetDuration: 7 }
add_audio                   { path: "~/music/track.wav" }
analyze_audio                                               → bpm 120, confidence 0.9
sync_to_beats               { mode: "every-n-beats", n: 4 }
render_preview                                              → a PNG to look at
```

> "Make the final word hit harder."

```
inspect_project                                             → find the last scene
apply_motion_style          { style: "aggressive" }
apply_typography_style      { style: "hero", size: "oversized" }
update_scene                { background: "green", emphasis: ["motivation"] }
render_preview                                              → look again
render_video                                                → jobId
get_render_status           poll until "done"
get_render_result                                           → the MP4
```

This exact sequence is an automated test
(`mcp/test/workflow.test.mjs`), so it is known to work rather than merely
documented.

---

## 13. Extending it

The tool layer is nine independent modules registered in `mcp/server.mjs`. To add
a capability:

1. Check the engine actually supports it — read `src/`, do not assume.
2. Add the vocabulary to `mcp/lib/schemas.mjs`, reading enums from the engine
   rather than typing them out.
3. Add the tool to the relevant `mcp/tools/*.mjs`, wrapped in `guard()`.
4. Add a test.

Future tools the current architecture would support cleanly: `generate_variations`
(duplicate + restyle), `extract_style` / `apply_style_from_project` (both are
document reads and writes), `suggest_timing` (the analysis is already there), and
image tools (the asset importer already exists).

Anything needing keyframes, video or per-property typography needs engine work
first — and should be built in `src/`, not worked around here.
