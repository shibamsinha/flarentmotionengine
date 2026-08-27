import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import type { CanvasFormat, OverlayImage, PaletteName, Scene } from './types/scene';
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
import { Transport } from './components/editor/Transport';
import { ImageStage } from './components/editor/ImageStage';
import { OverlayControls } from './components/editor/OverlayControls';
import { OverlayStage } from './components/editor/OverlayStage';
import { clearProject, loadProject, saveProject } from './utils/persistence';
import type { ImportedProject } from './utils/importScript';
import type { FieldOverrides } from './utils/typography';

/** Restored work wins over the demo reel; a first visit gets the demo. */
const restored = loadProject();

export const App: React.FC = () => {
  const [scenes, setScenes] = useState<Scene[]>(
    () => restored?.scenes ?? defaultScenes(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    restored?.selectedId ?? null,
  );
  const [palette, setPalette] = useState<PaletteName>(
    restored?.palette ?? DEFAULT_PALETTE,
  );
  /**
   * The project's frame. Chosen once, the same tier as the palette — not a
   * per-scene setting, which is why it lives here rather than on `Scene`.
   */
  const [format, setFormat] = useState<CanvasFormat>(
    restored?.format ?? DEFAULT_FORMAT,
  );
  const [fields, setFields] = useState<FieldOverrides>(restored?.fields ?? {});
  const [title, setTitle] = useState<string | null>(restored?.title ?? null);
  const [overlay, setOverlay] = useState<OverlayImage | null>(
    restored?.overlay ?? null,
  );
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
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState(true);
  const playerRef = useRef<PlayerRef | null>(null);

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
    const snapshot = { scenes, palette, format, fields, overlay, title, selectedId };
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
  }, [scenes, palette, format, fields, overlay, title, selectedId]);

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

  const resetProject = useCallback(() => {
    clearProject();
    const next = defaultScenes();
    setScenes(next);
    setPalette(DEFAULT_PALETTE);
    setFormat(DEFAULT_FORMAT);
    setFields({});
    setOverlay(null);
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
      setOverlay(project.overlay);
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

        <select
          className="preset"
          defaultValue="reference"
          onChange={(event) => loadPreset(event.target.value)}
          title="Load a length preset"
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
              overlay={overlay}
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
          </div>
        </div>

        <aside className="side-pane">
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
          <SceneEditor
            scene={selected}
            palette={palette}
            hasOverlay={overlay !== null}
            onChange={updateScene}
            canvas={canvas}
          />
          <OverlayControls
            overlay={overlay}
            scenes={scenes}
            onChange={setOverlay}
          />
        </aside>
      </div>

      <footer className="footer">
        <Timeline
          scenes={scenes}
          palette={palette}
          fields={fields}
          frame={frame}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSeek={seek}
        />
        <div className="footer-row">
          <Transport
            scenes={scenes}
            frame={frame}
            playing={playing}
            onSeek={seek}
            onTogglePlay={togglePlay}
          />
          {/*
            Project-level actions. They live beside Export because that is what
            they are — moving a whole reel in or out — and because the top bar
            is for what the reel *is*, not what you can do to it.
          */}
          <div className="project-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setImportOpen(true)}
              title="Import a JSON script"
            >
              Import JSON
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setExtractOpen(true)}
              title="Extract the current reel as JSON"
            >
              Extract JSON
            </button>
            <button
              type="button"
              className="btn"
              onClick={resetProject}
              title="Discard the saved project and reload the demo reel"
            >
              Reset
            </button>
          </div>

          <ExportBar
            scenes={scenes}
            palette={palette}
            format={format}
            fields={fields}
            overlay={overlay}
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
        overlay={overlay}
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
