/**
 * Project-level controls for the static overlay.
 *
 * Sits with the palette rather than with the scene controls, because that is
 * what it is: a property of the reel. Per-scene opting out lives in the scene
 * panel, where the exception belongs.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { ImageFit, OverlayImage, Scene } from '../../types/scene';
import {
  DEFAULT_OVERLAY,
  OVERLAY_MIN,
} from '../motion/OverlayLayer';
import { resolveImageSrc } from '../motion/SceneImageLayer';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export const OverlayControls: React.FC<{
  overlay: OverlayImage | null;
  scenes: Scene[];
  onChange: (next: OverlayImage | null) => void;
}> = ({ overlay, scenes, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const patch = (changes: Partial<OverlayImage>) => {
    if (!overlay) return;
    onChange({ ...overlay, ...changes });
  };

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/upload?name=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data?.error ?? `Upload failed (${response.status})`);

        // Start the box on the image's own proportions. A logo dropped into a
        // fixed rectangle and stretched is the first thing anyone notices.
        const ratio = await new Promise<number | null>((resolve) => {
          const probe = new Image();
          probe.onload = () =>
            resolve(
              probe.naturalHeight > 0 ? probe.naturalWidth / probe.naturalHeight : null,
            );
          probe.onerror = () => resolve(null);
          probe.src = resolveImageSrc(data.src);
        });

        const width = overlay?.width ?? DEFAULT_OVERLAY.width;
        const height =
          ratio && ratio > 0
            ? // Frame is 9:16, so a frame-fraction box is not square — convert
              // through the aspect of the canvas itself or the logo comes out
              // stretched by 1.78.
              Math.max(OVERLAY_MIN, (width * (1080 / 1920)) / ratio)
            : (overlay?.height ?? DEFAULT_OVERLAY.height);

        onChange({
          ...DEFAULT_OVERLAY,
          ...overlay,
          src: data.src,
          width,
          height: round3(height),
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? `${err.message}. Is the render server running?`
            : 'Upload failed',
        );
      } finally {
        setBusy(false);
      }
    },
    [overlay, onChange],
  );

  const hidden = scenes.filter((scene) => scene.hideOverlay).length;

  return (
    <div className="section">
      <div className="section-head">
        Static image
        <span className="spacer" />
        {overlay ? (
          <button
            type="button"
            className="btn"
            onClick={() => onChange(null)}
            title="Remove the overlay from the whole reel"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="controls">
        {overlay ? (
          <>
            <div className="overlay-file">
              <span title={overlay.src}>{overlay.src.replace(/^uploads\//, '')}</span>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Replace
              </button>
            </div>

            <div className="field-row">
              <div className="field">
                <label>X · {Math.round((overlay.x ?? 0) * 100)}%</label>
                <input
                  type="range"
                  min={-0.3}
                  max={1.1}
                  step={0.005}
                  value={overlay.x}
                  onChange={(event) => patch({ x: round3(Number(event.target.value)) })}
                />
              </div>
              <div className="field">
                <label>Y · {Math.round((overlay.y ?? 0) * 100)}%</label>
                <input
                  type="range"
                  min={-0.2}
                  max={1.1}
                  step={0.005}
                  value={overlay.y}
                  onChange={(event) => patch({ y: round3(Number(event.target.value)) })}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>Width · {Math.round((overlay.width ?? 0) * 100)}%</label>
                <input
                  type="range"
                  min={OVERLAY_MIN}
                  max={1.4}
                  step={0.005}
                  value={overlay.width}
                  onChange={(event) =>
                    patch({ width: round3(Number(event.target.value)) })
                  }
                />
              </div>
              <div className="field">
                <label>Height · {Math.round((overlay.height ?? 0) * 100)}%</label>
                <input
                  type="range"
                  min={OVERLAY_MIN}
                  max={1.4}
                  step={0.005}
                  value={overlay.height}
                  onChange={(event) =>
                    patch({ height: round3(Number(event.target.value)) })
                  }
                />
              </div>
            </div>

            <div className="field">
              <label>Opacity · {Math.round((overlay.opacity ?? 1) * 100)}%</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={overlay.opacity ?? 1}
                onChange={(event) =>
                  patch({ opacity: round3(Number(event.target.value)) })
                }
              />
            </div>

            <div className="field">
              <label>Fit</label>
              <div className="segmented">
                {(['contain', 'cover'] as ImageFit[]).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    className={(overlay.fit ?? 'contain') === fit ? 'is-on' : ''}
                    onClick={() => patch({ fit })}
                  >
                    {fit}
                  </button>
                ))}
              </div>
            </div>

            <p className="hint">
              Rendered over every scene and outside the scene timeline, so it
              never picks up a scene's animation.
              {hidden > 0
                ? ` Hidden on ${hidden} scene${hidden === 1 ? '' : 's'} — see “Static image” in the scene panel.`
                : ' Any scene can drop it from the scene panel.'}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn wide"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Uploading…' : 'Add a static image'}
            </button>
            <p className="hint">
              A logo, watermark or plate that holds still over the whole reel.
              Independent of scenes — no entrance, no exit, no motion.
            </p>
          </>
        )}

        {error ? <p className="hint is-error">{error}</p> : null}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
};
