/**
 * The scene's objects, as a list.
 *
 * Mirrors `SceneList` deliberately — same shape, same row actions, same place
 * in the panel — because a user who has learned how scenes work should not have
 * to learn a second idea to work with objects.
 *
 * Nesting is shown by indentation rather than by a tree widget with disclosure
 * arrows. A card with three children is three rows in, not a collapsed node to
 * hunt through, and at the depths this tool encourages (a card, its contents,
 * and that is usually all) the flat indented list is the whole story.
 *
 * Ordering *is* layering. Objects paint in array order, so "bring forward" is
 * literally moving a row down the list, and the list is therefore the honest
 * representation of z-order rather than a separate panel that has to agree
 * with it.
 */

import React, { useState } from 'react';
import type { ObjectKind, SceneObject } from '../../types/object';
import { Group } from './Group';
import {
  OBJECT_KIND_LABELS,
  flattenObjects,
  objectTitle,
} from '../../data/objects';

/** The order the add menu offers them in: most-reached-for first. */
const ADD_ORDER: ObjectKind[] = [
  'card', 'button', 'shape', 'icon', 'image', 'logo', 'cursor', 'group',
];

/** A one-word hint of what each kind is for, shown in the add menu. */
const ADD_HINT: Record<ObjectKind, string> = {
  card: 'A panel with a title and body',
  button: 'A label that can change state',
  shape: 'Rectangle, circle or line',
  icon: 'One of the built-in glyphs',
  image: 'A picture from a URL or upload',
  logo: 'The brand mark',
  cursor: 'A pointer that moves and clicks',
  group: 'Move and stagger things together',
};

export const ObjectList: React.FC<{
  objects: SceneObject[] | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: ObjectKind) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (to: 'front' | 'back' | 'forward' | 'backward') => void;
}> = ({ objects, selectedId, onSelect, onAdd, onDuplicate, onDelete, onReorder }) => {
  const [adding, setAdding] = useState(false);
  const rows = flattenObjects(objects);

  return (
    <Group
      title="Objects"
      summary={rows.length > 0 ? String(rows.length) : undefined}
      defaultOpen={rows.length > 0}
    >
      {/*
        An empty scene used to get two panels about objects it does not have:
        a list saying "No objects in this scene", and an inspector below it
        saying "Select an object to edit it". Two ways of saying nothing, and
        a row of five buttons of which four were disabled. Now there is one
        state with one thing to do in it.
      */}
      {rows.length === 0 && !adding ? (
        <div className="empty-state">
          <p className="empty-state-text">
            Cards, buttons, shapes and icons — the motion-graphics layer that
            sits over this scene's type.
          </p>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add an object
          </button>
        </div>
      ) : null}

      {rows.length > 0 ? (
      <div className="scene-rows object-rows">
        {rows.map(({ object, depth }) => (
          <button
            key={object.id}
            type="button"
            className={`scene-row object-row${object.id === selectedId ? ' is-active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onSelect(object.id)}
          >
            <span className="object-kind">{OBJECT_KIND_LABELS[object.type]}</span>
            <span className="label">{objectTitle(object)}</span>
            {object.motion?.enter && object.motion.enter !== 'none' ? (
              <span className="style-tag">{object.motion.enter.replace('-', ' ')}</span>
            ) : null}
          </button>
        ))}
      </div>
      ) : null}

      {adding ? (
        <div className="object-add">
          {ADD_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              className="object-add-item"
              onClick={() => {
                onAdd(kind);
                setAdding(false);
              }}
            >
              <span className="object-add-name">{OBJECT_KIND_LABELS[kind]}</span>
              <span className="object-add-hint">{ADD_HINT[kind]}</span>
            </button>
          ))}
          <button type="button" className="btn wide" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : rows.length > 0 ? (
        <div className="row-actions is-inline">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add object
          </button>
          <button
            type="button"
            className="btn"
            onClick={onDuplicate}
            disabled={!selectedId}
          >
            Duplicate
          </button>
          {/* Layering, as two arrows rather than a panel. Down the list is
              towards the viewer, because that is the order things paint in. */}
          <button
            type="button"
            className="btn"
            onClick={() => onReorder('backward')}
            disabled={!selectedId}
            title="Send backward"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onReorder('forward')}
            disabled={!selectedId}
            title="Bring forward"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={onDelete}
            disabled={!selectedId}
          >
            Delete
          </button>
        </div>
      ) : null}
    </Group>
  );
};
