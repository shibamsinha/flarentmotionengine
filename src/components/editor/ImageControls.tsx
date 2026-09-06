import React, { useCallback, useRef, useState } from 'react';
import type {
  ImageFit,
  ImageLayer,
  ImagePlacement,
  ImageSide,
  Scene,
  SceneImage,
} from '../../types/scene';
import {
  FREE_MIN,
  PANEL_MAX,
  PANEL_MIN,
  composeImage,
  freeBoxFrom,
} from '../../utils/imageLayout';
import { CANVAS } from '../../utils/timing';
import type { VideoConfig } from '../../types/scene';
import { resolveImageSrc } from '../motion/SceneImageLayer';
import { Disclosure } from './Disclosure';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif';

const PLACEMENTS: { value: ImagePlacement; label: string; note: string }[] = [
  { value: 'full', label: 'Full', note: 'Edge to edge, type over the picture.' },
  { value: 'panel', label: 'Panel', note: 'An inset plate; type takes the room left over.' },
  { value: 'split', label: 'Split', note: 'Picture owns half the frame, type the other half.' },
  {
    value: 'free',
    label: 'Free',
    note: 'Drag and resize the picture on the canvas, or set the box numerically below.',
  },
];

/** A percent field that edits one number of the free box. */
const NumberField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <label className="pct-field">
    <span>{label}</span>
    <input
      type="number"
      step={1}
      min={Math.round(min * 100)}
      max={Math.round(max * 100)}
      value={Math.round(value * 100)}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next / 100);
      }}
    />
    <span className="unit">%</span>
  </label>
);

export const ImageControls: React.FC<{
  scene: Scene;
  onChange: (patch: Partial<Scene>) => void;
  /** The project's frame. Portrait unless the project chose landscape. */
  canvas?: VideoConfig;
}> = ({ scene, onChange, canvas = CANVAS }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const image = scene.image;

  const patchImage = useCallback(
    (patch: Partial<SceneImage>) => {
      if (!scene.image) return;
      onChange({ image: { ...scene.image, ...patch } });
    },
    [scene.image, onChange],
  );

  /** Switching to Free keeps the picture exactly where the preset had it. */
  const setPlacement = useCallback(
    (placement: ImagePlacement) => {
      if (!scene.image) return;
      if (placement !== 'free') {
        patchImage({ placement });
        return;
      }
      const seeded = freeBoxFrom(composeImage(scene.image, canvas), canvas);
      patchImage({ placement, ...seeded });
    },
    [scene.image, patchImage, canvas],
  );

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
        if (!response.ok) throw new Error(data?.error ?? `Upload failed (${response.status})`);

        // Read the natural size so a Free box can start on the picture's own
        // proportions instead of an arbitrary rectangle.
        const dimensions = await new Promise<{ w: number; h: number } | null>(
          (resolve) => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = resolveImageSrc(data.src);
          },
        );

        onChange({
          image: {
            placement: 'full',
            side: 'top',
            size: 0.42,
            scrim: 0.42,
            focusX: 0.5,
            focusY: 0.5,
            fit: 'cover',
            layer: 'behind',
            ...scene.image,
            src: data.src,
            ...(dimensions
              ? { naturalWidth: dimensions.w, naturalHeight: dimensions.h }
              : {}),
          },
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
    [scene.image, onChange],
  );

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void upload(file);
  };

  const placement = image?.placement ?? 'full';
  const note = PLACEMENTS.find((p) => p.value === placement)?.note;
  const box = image ? freeBoxFrom(composeImage(image, canvas), canvas) : null;

  /** Reset the box to the picture's own aspect at a comfortable width. */
  const fitToAspect = useCallback(() => {
    if (!image || !box) return;
    const aspect =
      image.naturalWidth && image.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : 1;
    const width = 0.7;
    const height = (width * canvas.width) / aspect / canvas.height;
    patchImage({
      placement: 'free',
      width,
      height,
      x: (1 - width) / 2,
      y: (1 - height) / 2,
    });
  }, [image, box, patchImage, canvas]);

  return (
    <div className="field">
      <label>Image</label>

      {image ? (
        <div className="image-row">
          <span
            className="image-thumb"
            style={{ backgroundImage: `url("${resolveImageSrc(image.src)}")` }}
            aria-hidden
          />
          <div className="image-meta">
            <span className="hint" title={image.src}>
              {image.src.replace(/^uploads\//, '')}
            </span>
            <div className="image-actions">
              <button
                type="button"
                className="btn"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => onChange({ image: undefined })}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone${dragging ? ' is-over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files);
          }}
          disabled={busy}
        >
          {busy ? 'Uploading…' : 'Drop an image, or click to choose'}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = '';
        }}
      />

      {error ? <p className="hint is-error">{error}</p> : null}

      {image ? (
        <>
          <div className="segmented" style={{ marginTop: 8 }}>
            {PLACEMENTS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === placement ? 'is-on' : ''}
                onClick={() => setPlacement(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="hint">{note}</p>

          {placement === 'free' && box ? (
            <>
              <p className="hint">
                Drag the picture in the preview to move it, or pull a handle to
                resize. Corners keep its proportions — hold Shift to stretch.
              </p>
              <div className="image-actions">
                <button type="button" className="btn" onClick={fitToAspect}>
                  Fit to aspect
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    patchImage({
                      x: (1 - box.width) / 2,
                      y: (1 - box.height) / 2,
                    })
                  }
                >
                  Centre
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => patchImage({ x: 0, y: 0, width: 1, height: 1 })}
                >
                  Fill frame
                </button>
              </div>

              {/* The canvas has handles and the three buttons above cover the
                  common placements, so the box numbers are for matching one
                  picture to another exactly. */}
              <Disclosure label="Exact box">
              <div className="pct-grid">
                <NumberField
                  label="X"
                  value={box.x}
                  min={-2}
                  max={3}
                  onChange={(x) => patchImage({ x })}
                />
                <NumberField
                  label="Y"
                  value={box.y}
                  min={-2}
                  max={3}
                  onChange={(y) => patchImage({ y })}
                />
                <NumberField
                  label="W"
                  value={box.width}
                  min={FREE_MIN}
                  max={4}
                  onChange={(width) => patchImage({ width })}
                />
                <NumberField
                  label="H"
                  value={box.height}
                  min={FREE_MIN}
                  max={4}
                  onChange={(height) => patchImage({ height })}
                />
              </div>
              </Disclosure>

              <div className="field-row">
                <div className="field">
                  <label>Fit</label>
                  <div className="segmented">
                    {(['cover', 'contain'] as ImageFit[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={(image.fit ?? 'cover') === value ? 'is-on' : ''}
                        onClick={() => patchImage({ fit: value })}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Depth</label>
                  <div className="segmented">
                    {(['behind', 'front'] as ImageLayer[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={(image.layer ?? 'behind') === value ? 'is-on' : ''}
                        onClick={() => patchImage({ layer: value })}
                      >
                        {value === 'behind' ? 'Under type' : 'Over type'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {placement === 'panel' || placement === 'split' ? (
            <div className="segmented">
              {(['top', 'bottom'] as ImageSide[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={(image.side ?? 'top') === side ? 'is-on' : ''}
                  onClick={() => patchImage({ side })}
                >
                  {side === 'top' ? 'Picture top' : 'Picture bottom'}
                </button>
              ))}
            </div>
          ) : null}

          {placement === 'panel' ? (
            <div className="number-row">
              <span className="mini-label">Height</span>
              <input
                type="range"
                min={PANEL_MIN}
                max={PANEL_MAX}
                step={0.01}
                value={image.size ?? 0.42}
                onChange={(event) =>
                  patchImage({ size: Number(event.target.value) })
                }
              />
              <span className="mini-value">
                {Math.round((image.size ?? 0.42) * 100)}%
              </span>
            </div>
          ) : null}

          {/*
            Tint and focus. Both matter — a full-bleed picture usually needs a
            scrim before type will read on it, and a portrait cropped to 9:16
            usually needs its subject re-centred — but neither is the question
            you ask when you first drop a picture in.
          */}
          <Disclosure label="Tint and focus">
            <div className="number-row">
              <span className="mini-label">Tint</span>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.01}
                value={image.scrim ?? (placement === 'full' ? 0.42 : 0)}
                onChange={(event) =>
                  patchImage({ scrim: Number(event.target.value) })
                }
              />
              <span className="mini-value">
                {Math.round((image.scrim ?? (placement === 'full' ? 0.42 : 0)) * 100)}%
              </span>
            </div>

            <div className="number-row">
              <span className="mini-label">Focus X</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={image.focusX ?? 0.5}
                onChange={(event) =>
                  patchImage({ focusX: Number(event.target.value) })
                }
              />
              <span className="mini-value">
                {Math.round((image.focusX ?? 0.5) * 100)}
              </span>
            </div>
            <div className="number-row">
              <span className="mini-label">Focus Y</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={image.focusY ?? 0.5}
                onChange={(event) =>
                  patchImage({ focusY: Number(event.target.value) })
                }
              />
              <span className="mini-value">
                {Math.round((image.focusY ?? 0.5) * 100)}
              </span>
            </div>
            <p className="hint">
              Tint darkens the picture so type can sit on it. Focus decides
              which part survives the crop.
            </p>
          </Disclosure>
        </>
      ) : null}
    </div>
  );
};
