/**
 * Extract JSON — the current reel, as the document the importer accepts.
 *
 * The inverse of the import sheet, and deliberately the *same* format: whatever
 * comes out of here can be dropped straight back in, handed to someone else, or
 * used as the worked example a model is shown when the AI layer arrives. A
 * bespoke "export format" would be a second schema to keep in step with the
 * first.
 *
 * `serialiseProject` does the work; this is the surface around it — see it,
 * copy it, save it.
 */

import type { ProjectAudio } from '../../types/audio';
import React, { useMemo, useState } from 'react';
import type { CanvasFormat, OverlayImage, Scene } from '../../types/scene';
import { serialiseProject } from '../../utils/importScript';
import type { FieldOverrides } from '../../utils/typography';
import { CANVAS, totalFrames } from '../../utils/timing';

/** A filename that says what the reel is, the way the render server's does. */
const filenameFor = (scenes: Scene[], title: string | null, frames: number): string => {
  const source =
    title?.trim() ||
    scenes
      .slice(0, 3)
      .map((scene) => scene.text.replace(/\n/g, ' '))
      .join(' ');
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  // Don't double the prefix when the reel is already named "Flarent something".
  const body = slug || 'reel';
  return `${body.startsWith('flarent') ? body : `flarent-${body}`}-${frames}f.json`;
};

export const ExtractPanel: React.FC<{
  open: boolean;
  scenes: Scene[];
  title: string | null;
  format: CanvasFormat;
  fields: FieldOverrides;
  overlay: OverlayImage | null;
  /** V7 — included so an extracted project carries its audio. */
  audio: ProjectAudio | null;
  onClose: () => void;
}> = ({ open, scenes, title, format, fields, overlay, audio, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Serialising the whole reel on every keystroke elsewhere would be wasteful,
  // and the panel is usually shut.
  const json = useMemo(
    () => (open ? serialiseProject(scenes, title, fields, overlay, format, audio) : ''),
    [open, scenes, title, fields, overlay, format, audio],
  );

  const frames = totalFrames(scenes, CANVAS.fps);
  const filename = filenameFor(scenes, title, frames);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the textarea below is still selectable.
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in some browsers; one tick
    // is enough for it to have started.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  if (!open) return null;

  const composed = scenes.filter((scene) => (scene.elements?.length ?? 0) > 0).length;
  const withImages = scenes.filter((scene) => scene.image).length;
  const hidden = scenes.filter((scene) => scene.hideOverlay).length;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Extract JSON"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-head">
          <span>Extract JSON</span>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={download}>
            {saved ? 'Saved' : 'Download .json'}
          </button>
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="sheet-body">
          <div className="extract-meta">
            <span>
              <b>{scenes.length}</b> scenes
            </span>
            <span>
              <b>{(frames / CANVAS.fps).toFixed(2)}</b> s
            </span>
            <span>
              <b>{frames}</b> frames
            </span>
            {composed > 0 ? (
              <span>
                <b>{composed}</b> composed
              </span>
            ) : null}
            {withImages > 0 ? (
              <span>
                <b>{withImages}</b> with images
              </span>
            ) : null}
            {overlay ? (
              <span>
                static image{hidden > 0 ? ` · hidden on ${hidden}` : ''}
              </span>
            ) : null}
            <span className="spacer" />
            <code>{filename}</code>
          </div>

          <textarea
            className="text-input script-input"
            spellCheck={false}
            readOnly
            value={json}
            onFocus={(event) => event.currentTarget.select()}
          />

          <p className="hint">
            This is the same document the importer reads, so it round-trips:
            drop it into Import JSON and you get this reel back. Images and the
            static image travel as paths under <code>public/</code> — the files
            themselves are not embedded, so move <code>public/uploads/</code>
            along with the JSON if you are handing it to someone else.
          </p>
        </div>
      </div>
    </div>
  );
};
