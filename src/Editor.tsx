/**
 * The editor.
 *
 * This is the V1–V4 editor unchanged. V5 moved it out of `App.tsx` (which is
 * now the start flow's router) and swapped one thing: it used to read the
 * auto-save itself at module scope, and now it is handed a `Project` on the way
 * in. That is the only behavioural difference — the start screen decides *what*
 * to open, and this file has no idea whether the project came from a blank
 * canvas, an imported file or a Reference Reel.
 *
 * `initial` seeds state and is then owned by this component; the start screen
 * never sends a second one, which is why there is no effect syncing them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { CanvasFormat, OverlayImage, PaletteName, Scene } from './types/scene';
import type { Project } from './types/project';
import { blankScene, defaultScenes, makeSceneId } from './data/defaultScenes';
import { PRESETS } from './data/presets';
import {
  CANVAS,
  DEFAULT_FORMAT,
  FORMAT_LABEL,
  buildTimeline,
  canvasFor,
  totalFrames,
} from './utils/timing';
import {
  DEFAULT_PALETTE,
  FIELDS,
  PALETTES,
  PALETTE_NAMES,
  flipBackground,
  remapBackground,
} from './utils/typography';
import { VideoPreview } from './components/editor/VideoPreview';
import { SceneList } from './components/editor/SceneList';
import { SceneEditor } from './components/editor/SceneEditor';
import { Timeline } from './components/editor/Timeline';
import { ExportBar } from './components/editor/ExportBar';
import { ImportPanel } from './components/editor/ImportPanel';
import { ExtractPanel } from './components/editor/ExtractPanel';
import { Logo } from './components/editor/Logo';
import { Group } from './components/editor/Group';
import { Transport } from './components/editor/Transport';
import { ImageStage } from './components/editor/ImageStage';
import { OverlayControls } from './components/editor/OverlayControls';
import { OverlayStage } from './components/editor/OverlayStage';
import { AudioControls } from './components/editor/AudioControls';
import { PaletteControls } from './components/editor/PaletteControls';
import { PhraseBuildPanel } from './components/editor/PhraseBuildPanel';
import type { ProjectAudio } from './types/audio';
import { ObjectList } from './components/editor/ObjectList';
import { ObjectInspector } from './components/editor/ObjectInspector';
import { ObjectStage } from './components/editor/ObjectStage';
import { TextStage } from './components/editor/TextStage';
import type { ObjectKind, SceneObject } from './types/object';
import {
  addObject,
  duplicateObject,
  findObject,
  flattenObjects,
  newObject,
  objectTitle,
  removeObject,
  reorderObject,
  updateObject,
} from './data/objects';
import { themeFor } from './utils/typography';
import { clearProject, saveProject } from './utils/persistence';
import type { ImportedProject } from './utils/importScript';
import type { FieldOverrides } from './utils/typography';

export const Editor: React.FC<{ initial: Project }> = ({ initial }) => {
  const [scenes, setScenes] = useState<Scene[]>(() => initial.scenes);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.selectedId,
  );
  const [palette, setPalette] = useState<PaletteName>(initial.palette);
  /**
   * The project's frame. Chosen once, the same tier as the palette — not a
   * per-scene setting, which is why it lives here rather than on `Scene`.
   */
  const [format, setFormat] = useState<CanvasFormat>(initial.format);
  const [fields, setFields] = useState<FieldOverrides>(initial.fields);
  /* V8 — explicit ink per field, and the project accent. Both empty/null by
     default, which is what keeps every pre-V8 project rendering identically. */
  const [ink, setInk] = useState<FieldOverrides>(initial.ink);
  const [accent, setAccent] = useState<string | null>(initial.accent);
  const [title, setTitle] = useState<string | null>(initial.title);
  const [overlay, setOverlay] = useState<OverlayImage | null>(initial.overlay);
  /**
   * V7 — the project's audio. Peer of `overlay`, not of anything in `scenes`:
   * editing a scene's duration must never move or restart it.
   */
  const [audio, setAudio] = useState<ProjectAudio | null>(initial.audio);
  const [importOpen, setImportOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [frame, setFrame] = useState(0);
  /**
   * What is selected on the canvas. Handles belong to a selection, not to an
   * object — a box that is permanently on sits over the frame you are trying to
   * judge, and gives no way to say "I am done with this one".
   */
  const [canvasTarget, setCanvasTarget] = useState<'image' | 'overlay' | null>(
    null,
  );
  /** V6 — which object the object list and the canvas box are pointed at. */
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  /** Which piece of type is grabbed on the canvas. Scene-scoped, like objects. */
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState(true);
  /**
   * Which half of the inspector is showing.
   *
   * The column used to carry eight sections at once, four of which described
   * the *project* (palette, static image, audio, phrase build) and had nothing
   * to do with whatever was selected — so a scene's text box and the reel's
   * colour scheme sat in the same scroll, 3,700px deep. Splitting them is not a
   * new capability; it is the same panels, told apart by what they are about.
   *
   * Deliberately *not* persisted. It is a view state, not a project state: it
   * has no business in the auto-save or in the extracted JSON.
   */
  const [inspectorTab, setInspectorTab] = useState<'scene' | 'project'>('scene');
  const playerRef = useRef<PlayerRef | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  const selected = scenes.find((scene) => scene.id === selectedId) ?? null;
  const frames = totalFrames(scenes, CANVAS.fps);
  const seconds = frames / CANVAS.fps;
  // Portrait unless the project chose landscape. Fed to every editor overlay
  // that draws on top of the player — the boxes in BoxStage, ImageStage and
  // OverlayStage are plain divs outside the Remotion tree, so unlike the
  // renderer they cannot read the frame back from `useVideoConfig`.
  const canvas = useMemo(() => canvasFor(format), [format]);

  /**
   * The picture handles only make sense when the scene owning them is the one
   * actually on screen — otherwise you would be dragging a box over a frame
   * that belongs to a different scene.
   */
  const selectedIsOnScreen = useMemo(() => {
    if (!selectedId) return false;
    const entry = buildTimeline(scenes, CANVAS.fps).find(
      (candidate) => candidate.scene.id === selectedId,
    );
    return Boolean(
      entry && frame >= entry.from && frame < entry.from + entry.durationInFrames,
    );
  }, [scenes, selectedId, frame]);

  /**
   * Auto-save. Debounced so a duration drag does not write on every frame, and
   * flushed on hide/unload because a backgrounded tab can be evicted before the
   * timer fires — which is exactly how work was being lost.
   */
  useEffect(() => {
    setSaved(false);
    const snapshot = { scenes, palette, format, fields, ink, accent, overlay, audio, title, selectedId };
    const timer = window.setTimeout(() => {
      setSaved(saveProject(snapshot));
    }, 400);

    const flush = () => {
      if (document.visibilityState === 'hidden') saveProject(snapshot);
    };
    window.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [scenes, palette, format, fields, ink, accent, overlay, audio, title, selectedId]);

  // Escape is the other half of clicking away — reachable when the object
  // fills the frame and there is no empty canvas left to click.
  useEffect(() => {
    if (canvasTarget === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCanvasTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasTarget]);

  // Nothing stays selected across a play, and an overlay that has been removed
  // cannot stay selected either.
  useEffect(() => {
    if (playing) setCanvasTarget(null);
  }, [playing]);
  useEffect(() => {
    if (!overlay) setCanvasTarget((current) => (current === 'overlay' ? null : current));
  }, [overlay]);

  // Open on the first scene so the controls are never empty on load.
  useEffect(() => {
    if (!selectedId && scenes.length > 0) setSelectedId(scenes[0].id);
  }, [scenes, selectedId]);

  /**
   * The two tabs share one scroll container, so without this you arrive at the
   * project tab parked wherever the scene tab happened to be — which is how
   * clicking the audio lane could land you on the palette. Each tab opens at
   * its own top.
   */
  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0 });
  }, [inspectorTab]);

  // Objects belong to a scene, so a scene change drops the object selection —
  // otherwise the inspector would keep editing an object that is no longer on
  // screen, and the canvas box would sit over a different scene's frame.
  useEffect(() => {
    setSelectedObjectId(null);
    setSelectedElementId(null);
  }, [selectedId]);

  const seek = useCallback((target: number) => {
    playerRef.current?.seekTo(target);
    setFrame(target);
  }, []);

  /** Select a scene and park the playhead on its first frame. */
  const selectScene = useCallback(
    (id: string, scenesOverride?: Scene[]) => {
      setSelectedId(id);
      const list = scenesOverride ?? scenes;
      const entry = buildTimeline(list, CANVAS.fps).find(
        (candidate) => candidate.scene.id === id,
      );
      if (entry) seek(entry.from);
    },
    [scenes, seek],
  );

  const updateScene = useCallback(
    (patch: Partial<Scene>) => {
      if (!selectedId) return;
      setScenes((current) =>
        current.map((scene) =>
          scene.id === selectedId ? { ...scene, ...patch } : scene,
        ),
      );
    },
    [selectedId],
  );

  const addScene = useCallback(() => {
    const index = scenes.findIndex((scene) => scene.id === selectedId);
    const previous = index >= 0 ? scenes[index] : scenes[scenes.length - 1];
    const created = blankScene({
      // Alternate the field so a fresh scene already cuts against its neighbour.
      background: flipBackground(previous?.background ?? 'cream', palette),
      alignment: previous?.alignment ?? 'center',
    });
    const at = index >= 0 ? index + 1 : scenes.length;
    const next = [...scenes.slice(0, at), created, ...scenes.slice(at)];
    setScenes(next);
    selectScene(created.id, next);
  }, [scenes, selectedId, selectScene, palette]);

  const duplicateScene = useCallback(() => {
    const index = scenes.findIndex((scene) => scene.id === selectedId);
    if (index < 0) return;
    const copy: Scene = {
      ...scenes[index],
      id: makeSceneId(),
      emphasis: [...(scenes[index].emphasis ?? [])],
    };
    const next = [
      ...scenes.slice(0, index + 1),
      copy,
      ...scenes.slice(index + 1),
    ];
    setScenes(next);
    selectScene(copy.id, next);
  }, [scenes, selectedId, selectScene]);

  const deleteScene = useCallback(() => {
    const index = scenes.findIndex((scene) => scene.id === selectedId);
    if (index < 0) return;
    const next = scenes.filter((scene) => scene.id !== selectedId);
    setScenes(next);
    const fallback = next[Math.min(index, next.length - 1)];
    if (fallback) selectScene(fallback.id, next);
    else setSelectedId(null);
  }, [scenes, selectedId, selectScene]);

  const moveScene = useCallback(
    (offset: -1 | 1) => {
      const index = scenes.findIndex((scene) => scene.id === selectedId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= scenes.length) return;
      const next = [...scenes];
      [next[index], next[target]] = [next[target], next[index]];
      setScenes(next);
      selectScene(next[target].id, next);
    },
    [scenes, selectedId, selectScene],
  );

  /* --------------------------------------------------------- V6 objects */

  /**
   * Every object edit is the same shape: rewrite the selected scene's `objects`
   * and hand it to `updateScene`, which already knows how to patch a scene.
   * Nothing here reaches into the renderer or the planner.
   */
  const withObjects = useCallback(
    (fn: (objects: SceneObject[]) => SceneObject[]) => {
      if (!selected) return;
      updateScene({ objects: fn(selected.objects ?? []) });
    },
    [selected, updateScene],
  );

  const addSceneObject = useCallback(
    (kind: ObjectKind) => {
      const object = newObject(kind);
      // Dropped into the selected object when that object can hold children,
      // so "add a button to this card" is one click rather than a re-parent.
      const parent = selectedObjectId
        ? findObject(selected?.objects, selectedObjectId)
        : null;
      const into = parent && (parent.type === 'card' || parent.type === 'group')
        ? parent.id
        : null;
      withObjects((objects) => addObject(objects, object, into));
      setSelectedObjectId(object.id);
    },
    [withObjects, selected, selectedObjectId],
  );

  const patchObject = useCallback(
    (patch: Partial<SceneObject>) => {
      if (!selectedObjectId) return;
      withObjects((objects) => updateObject(objects, selectedObjectId, patch));
    },
    [withObjects, selectedObjectId],
  );

  const deleteObject = useCallback(() => {
    if (!selectedObjectId) return;
    withObjects((objects) => removeObject(objects, selectedObjectId));
    setSelectedObjectId(null);
  }, [withObjects, selectedObjectId]);

  const duplicateSceneObject = useCallback(() => {
    if (!selectedObjectId) return;
    withObjects((objects) => duplicateObject(objects, selectedObjectId));
  }, [withObjects, selectedObjectId]);

  const reorderSceneObject = useCallback(
    (to: 'front' | 'back' | 'forward' | 'backward') => {
      if (!selectedObjectId) return;
      withObjects((objects) => reorderObject(objects, selectedObjectId, to));
    },
    [withObjects, selectedObjectId],
  );

  const resetProject = useCallback(() => {
    clearProject();
    const next = defaultScenes();
    setScenes(next);
    setPalette(DEFAULT_PALETTE);
    setFormat(DEFAULT_FORMAT);
    setFields({});
    setOverlay(null);
    setAudio(null);
    setTitle(null);
    setSelectedId(next[0]?.id ?? null);
    seek(0);
  }, [seek]);

  const loadPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((candidate) => candidate.id === id);
      if (!preset) return;
      const next = preset.build();
      setScenes(next);
      setSelectedId(null);
      setFields({});
      setInk({});
      setAccent(null);
      setTitle(null);
      seek(0);
    },
    [seek],
  );

  /**
   * Applying an import is atomic — parseFlarentScript() has already validated
   * the whole document, so by the time we get here nothing can half-fail.
   */
  const applyImport = useCallback(
    (project: ImportedProject) => {
      setScenes(project.scenes);
      setPalette(project.palette);
      setFormat(project.format);
      setFields(project.fields);
      setInk(project.ink);
      setAccent(project.accent);
      setOverlay(project.overlay);
      setAudio(project.audio);
      setTitle(project.title);
      setSelectedId(project.scenes[0]?.id ?? null);
      seek(0);
      setImportOpen(false);
    },
    [seek],
  );

  /**
   * Switching palette re-points every scene's dark field. Cream stays cream —
   * it is the light half of both pairs — so the reel keeps its rhythm and only
   * changes identity.
   */
  const changePalette = useCallback((next: PaletteName) => {
    setPalette(next);
    setScenes((current) =>
      current.map((scene) => ({
        ...scene,
        background: remapBackground(scene.background, next),
      })),
    );
  }, []);

  const togglePlay = useCallback(() => {
    playerRef.current?.toggle();
  }, []);

  const meta = useMemo(
    () => ({
      scenes: scenes.length,
      seconds: seconds.toFixed(2),
      frames,
    }),
    [scenes.length, seconds, frames],
  );

  return (
    <div className="app">
      <header className="topbar">
        <Logo />

        {/*
          The reel's name, edited in place. It travels with the project — into
          the auto-save, the extracted JSON and the export filename — so it
          belongs on the chrome rather than buried in a panel.
        */}
        <input
          className="project-title"
          value={title ?? ''}
          placeholder="Untitled reel"
          spellCheck={false}
          aria-label="Project title"
          onChange={(event) => setTitle(event.target.value || null)}
        />

        {/*
          The bar carries what the reel *is* — its name, its shape, its colours
          and its size — grouped so the three tiers read as three tiers rather
          than as one run of controls. What you can *do* to a reel moved to the
          project tab; the two were never the same kind of thing.
        */}
        <span className="topbar-rule" aria-hidden />

        <select
          className="preset"
          defaultValue="reference"
          onChange={(event) => loadPreset(event.target.value)}
          title="Replace this reel with a Reference Reel"
          aria-label="Start from a reference reel"
        >
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} — {preset.note}
            </option>
          ))}
        </select>
        <div className="palette-switch" role="group" aria-label="Format">
          {(['portrait', 'landscape'] as CanvasFormat[]).map((name) => (
            <button
              key={name}
              type="button"
              className={`palette-chip${name === format ? ' is-on' : ''}`}
              onClick={() => setFormat(name)}
              title={`Render this reel as ${FORMAT_LABEL[name]}`}
            >
              <span
                className="format-glyph"
                data-orientation={name}
                aria-hidden
              />
              {name === 'portrait' ? '9:16' : '16:9'}
            </button>
          ))}
        </div>
        <div className="palette-switch" role="group" aria-label="Palette">
          {PALETTE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className={`palette-chip${name === palette ? ' is-on' : ''}`}
              onClick={() => changePalette(name)}
              title={`Switch the reel to ${PALETTES[name].label}`}
            >
              <span
                className="dot"
                style={{ background: FIELDS[PALETTES[name].dark] }}
              />
              <span className="dot" style={{ background: FIELDS.cream }} />
              {PALETTES[name].label}
            </button>
          ))}
        </div>
        <div className="topbar-meta">
          <span>
            <b>{meta.scenes}</b> scenes
          </span>
          <span>
            <b>{meta.seconds}</b> s
          </span>
          <span>
            <b>{meta.frames}</b> frames
          </span>
          <span>
            {canvas.width}×{canvas.height} · {CANVAS.fps}fps
          </span>
        </div>
      </header>

      <div className="stage">
        {/*
          The reel, as navigation.

          Scenes used to sit at the top of the inspector, which meant choosing
          what to work on and working on it competed for the same 400px of
          scroll — and the scene list was capped at 244px so that it would not
          push the controls out of reach, which is the compromise you make when
          two jobs share one column. In a rail it has the height it wants and
          the inspector is left to do one thing.
        */}
        <aside className="rail">
          <SceneList
            scenes={scenes}
            palette={palette}
            fields={fields}
            selectedId={selectedId}
            onSelect={(id) => selectScene(id)}
            onAdd={addScene}
            onDuplicate={duplicateScene}
            onDelete={deleteScene}
            onMove={moveScene}
          />
        </aside>

        <div className="canvas-pane">
          {/*
            The CSS default is portrait (9/16); landscape overrides it inline
            rather than via a class, so the shape a viewer sees always matches
            `canvas` exactly — including for any future format this ever grows
            beyond a fixed two-way switch.
          */}
          <div
            className="canvas-holder"
            style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
          >
            <VideoPreview
              scenes={scenes}
              palette={palette}
              format={format}
              fields={fields}
              ink={ink}
              accent={accent}
              overlay={overlay}
              audio={audio}
              playerRef={playerRef}
              onFrame={setFrame}
              onPlayingChange={setPlaying}
            />
            {/* Click-away target. Sits under both boxes, so a press that lands
                on a box is stopped there and only an empty-canvas press clears
                the selection. */}
            <div
              className="stage-backdrop"
              onPointerDown={() => setCanvasTarget(null)}
            />
            <ImageStage
              scene={selected}
              canvas={canvas}
              active={!playing && selectedIsOnScreen}
              selected={canvasTarget === 'image'}
              onSelect={() => setCanvasTarget('image')}
              onChange={updateScene}
            />
            {/*
              After ImageStage so its handles sit on top — the overlay renders
              over every scene, and the editor should stack the same way.
            */}
            <OverlayStage
              overlay={overlay}
              scenes={scenes}
              canvas={canvas}
              frame={frame}
              active={!playing}
              selected={canvasTarget === 'overlay'}
              onSelect={() => setCanvasTarget('overlay')}
              onChange={setOverlay}
            />
            {/* Type boxes. Before ObjectStage so an object's handles win when
                the two overlap — the same order they render in. */}
            <TextStage
              scene={selected}
              palette={palette}
              canvas={canvas}
              selectedElementId={selectedElementId}
              active={!playing && selectedIsOnScreen}
              onSelect={setSelectedElementId}
              onChange={updateScene}
            />
            {/* V6 — the selected object's box. Last, so its handles are the
                ones you reach when boxes overlap. */}
            <ObjectStage
              objects={selected?.objects}
              selectedId={selectedObjectId}
              canvas={canvas}
              active={!playing && selectedIsOnScreen}
              onSelect={setSelectedObjectId}
              onChange={patchObject}
            />
          </div>
        </div>

        <aside className="side-pane">
          {/*
            Two contexts, not eight sections. "Scene" is whatever is selected;
            "Project" is everything true of the whole reel. Both are the same
            panels that were here before — this only decides which of them are
            on screen at once.
          */}
          <div className="inspector-tabs" role="tablist" aria-label="Inspector">
            {(['scene', 'project'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab}
                className={`inspector-tab${inspectorTab === tab ? ' is-on' : ''}`}
                onClick={() => setInspectorTab(tab)}
              >
                {tab === 'scene' ? 'Scene' : 'Project'}
              </button>
            ))}
          </div>

          <div className="inspector-body" ref={inspectorRef}>
            {inspectorTab === 'scene' ? (
              <>
                <SceneEditor
                  onAddScene={addScene}
                  scene={selected}
                  palette={palette}
                  fields={fields}
                  ink={ink}
                  accent={accent}
                  hasOverlay={overlay !== null}
                  onChange={updateScene}
                  canvas={canvas}
                />
                {/*
                  V6 — objects live below the scene's own controls: a scene is
                  still primarily its type, and the graphics sit on top of it.
                */}
                <ObjectList
                  objects={selected?.objects}
                  selectedId={selectedObjectId}
                  onSelect={setSelectedObjectId}
                  onAdd={addSceneObject}
                  onDuplicate={duplicateSceneObject}
                  onDelete={deleteObject}
                  onReorder={reorderSceneObject}
                />
                <ObjectInspector
                  object={
                    selectedObjectId
                      ? findObject(selected?.objects, selectedObjectId)
                      : null
                  }
                  ink={themeFor(selected?.background ?? 'green', palette, fields).ink}
                  onChange={patchObject}
                  targets={flattenObjects(selected?.objects).map(({ object }) => ({
                    id: object.id,
                    label: objectTitle(object),
                  }))}
                />
              </>
            ) : (
              <>
                {/*
                  V7 — the audio track. Its entry point is the lane it already
                  draws on the timeline, which is where you notice it; this is
                  where it is edited. `onSeekSeconds` drives the same playhead
                  the transport does — there is still exactly one clock.
                */}
                <AudioControls
                  audio={audio}
                  videoSeconds={seconds}
                  onChange={setAudio}
                  onSeekSeconds={(s) => seek(Math.round(s * CANVAS.fps))}
                />

                <OverlayControls
                  overlay={overlay}
                  scenes={scenes}
                  onChange={setOverlay}
                />

                {/*
                  V8.3 — a faster way to start a run of scenes. It writes
                  ordinary scenes through the same `setScenes` every other edit
                  uses, so there is nothing special about what it produces.
                */}
                <PhraseBuildPanel
                  onBuild={(built, replace) => {
                    setScenes((current) => (replace ? built : [...current, ...built]));
                    setSelectedId(built[0]?.id ?? null);
                    seek(0);
                    // The scenes it makes are the thing you want to look at
                    // next, and they are not on this tab.
                    setInspectorTab('scene');
                  }}
                />

                {/* V8 — project colours. */}
                <PaletteControls
                  palette={palette}
                  fields={fields}
                  ink={ink}
                  accent={accent}
                  onFields={setFields}
                  onInk={setInk}
                  onAccent={setAccent}
                />

                {/*
                  Moving a whole reel in or out, and starting from a different
                  one. These were in the footer, which the redesign gives over
                  to playback and export; they are project-level actions and
                  this is the project tab.
                */}
                <Group title="Project file" defaultOpen={false}>
                    <div className="field">
                      <label htmlFor="preset-select">Start from a reference reel</label>
                      <select
                        id="preset-select"
                        className="text-input"
                        defaultValue="reference"
                        onChange={(event) => loadPreset(event.target.value)}
                      >
                        {PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label} — {preset.note}
                          </option>
                        ))}
                      </select>
                      <p className="hint">
                        Replaces every scene in this reel. Extract the JSON first
                        if you want to keep what is here.
                      </p>
                    </div>

                    <div className="field">
                      <label>This reel</label>
                      <div className="chips">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setImportOpen(true)}
                        >
                          Import JSON
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setExtractOpen(true)}
                        >
                          Extract JSON
                        </button>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={resetProject}
                        >
                          Reset
                        </button>
                      </div>
                      <p className="hint">
                        Extract and Import are inverses — whatever comes out of
                        one goes back into the other unchanged.
                      </p>
                    </div>
                </Group>
              </>
            )}
          </div>
        </aside>
      </div>

      {/*
        Playback and export, and nothing else. Import / Extract / Reset used to
        sit between the transport and the export button, which put three
        document actions in the middle of the one row that is about watching
        the thing play. They are on the project tab now.
      */}
      <footer className="footer">
        <Timeline
          scenes={scenes}
          palette={palette}
          fields={fields}
          frame={frame}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSeek={seek}
          audio={audio}
          onOpenAudio={() => setInspectorTab('project')}
        />
        <div className="footer-row">
          <Transport
            scenes={scenes}
            frame={frame}
            playing={playing}
            onSeek={seek}
            onTogglePlay={togglePlay}
          />

          <ExportBar
            scenes={scenes}
            palette={palette}
            format={format}
            fields={fields}
            ink={ink}
            accent={accent}
            overlay={overlay}
            audio={audio}
            saved={saved}
          />
        </div>
      </footer>

      <ExtractPanel
        open={extractOpen}
        scenes={scenes}
        title={title}
        format={format}
        fields={fields}
        ink={ink}
        accent={accent}
        overlay={overlay}
        audio={audio}
        onClose={() => setExtractOpen(false)}
      />

      <ImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={applyImport}
      />
    </div>
  );
};
