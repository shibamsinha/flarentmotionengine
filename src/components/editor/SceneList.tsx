import React from 'react';
import type { PaletteName, Scene } from '../../types/scene';
import type { FieldOverrides } from '../../utils/typography';
import { themeFor } from '../../utils/typography';
import { styleDefinition } from '../motion/registry';
import { formatSeconds } from '../../utils/timing';

const preview = (text: string): string =>
  text.replace(/\s+/g, ' ').trim() || '(empty)';

export const SceneList: React.FC<{
  scenes: Scene[];
  palette: PaletteName;
  fields: FieldOverrides;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (offset: -1 | 1) => void;
}> = ({
  scenes,
  palette,
  fields,
  selectedId,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
}) => {
  const index = scenes.findIndex((scene) => scene.id === selectedId);

  return (
    <div className="section">
      <div className="section-head">
        Scenes
        <span className="spacer" />
        <span>{scenes.length}</span>
      </div>

      <div className="scene-rows">
        {scenes.map((scene, i) => (
          <button
            key={scene.id}
            type="button"
            className={`scene-row${scene.id === selectedId ? ' is-active' : ''}`}
            onClick={() => onSelect(scene.id)}
          >
            <span
              className="swatch"
              style={{ background: themeFor(scene.background, palette, fields).background }}
              aria-hidden
            />
            <span className="idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="label">
              {scene.image ? <i className="has-image" title="Has an image" /> : null}
              {preview(scene.text)}
            </span>
            <span className="dur">{formatSeconds(scene.duration)}</span>
            <span className="style-tag">
              {styleDefinition(scene.style).label}
            </span>
          </button>
        ))}
        {scenes.length === 0 ? (
          <p className="hint" style={{ padding: '8px' }}>
            No scenes yet. Add one to start the reel.
          </p>
        ) : null}
      </div>

      <div className="row-actions">
        <button type="button" className="btn" onClick={onAdd}>
          + Add
        </button>
        <button
          type="button"
          className="btn"
          onClick={onDuplicate}
          disabled={index < 0}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onMove(-1)}
          disabled={index <= 0}
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onMove(1)}
          disabled={index < 0 || index >= scenes.length - 1}
          title="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={onDelete}
          disabled={index < 0}
        >
          Delete
        </button>
      </div>
    </div>
  );
};
