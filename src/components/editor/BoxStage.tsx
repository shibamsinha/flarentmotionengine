/**
 * Direct manipulation of a box on the canvas.
 *
 * Overlays the player with a rectangle you can drag and resize. The stage
 * tracks the player's on-screen rect, so pointer movement is converted straight
 * into composition pixels — what you drag is exactly what renders, at any
 * preview size.
 *
 * Two things use this: a scene's free-placed picture, and the project's static
 * overlay. They differ only in what they read and what they write, so the
 * pointer arithmetic — capture, corner aspect locking, minimum sizes, mapping
 * screen pixels back through the preview scale — lives here once. Two copies of
 * this maths would be two copies to keep in step.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS } from '../../utils/timing';

export type Box = { x: number; y: number; width: number; height: number };

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

type Drag = {
  handle: Handle | 'move';
  startPointer: { x: number; y: number };
  startBox: Box;
  aspect: number;
};

export const BoxStage: React.FC<{
  /** The box as it is now, in composition pixels. */
  rect: Box;
  /** Smallest the box may get, in composition pixels. */
  min: { width: number; height: number };
  onChange: (box: Box) => void;
  /**
   * Whether this object is the current canvas selection.
   *
   * Unselected, the box is an invisible hit area rather than nothing at all —
   * something has to be clickable for the object to be selectable again. It
   * shows a faint outline on hover so it is discoverable without being
   * permanent furniture over the frame.
   */
  selected: boolean;
  onSelect: () => void;
  /**
   * Called once when a drag begins, before any movement. Used by the scene
   * picture to switch itself to `free` placement seeded from wherever it
   * already is, so the first pixel of movement does not also move the box.
   */
  onGrab?: () => void;
  /** Distinguishes the two stages visually. */
  variant?: 'image' | 'overlay';
  /** Shown while dragging. Defaults to the box size in composition pixels. */
  readout?: (box: Box) => string;
}> = ({ rect, min, onChange, selected, onSelect, onGrab, variant = 'image', readout }) => {
  // A callback ref, not useRef: the host mounts when the thing being edited is
  // attached, which is not a prop change, so an effect keyed on props would
  // never re-run and the scale would stay zero.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  // Map composition pixels to screen pixels by watching the stage's own box,
  // which is stretched over the player.
  useEffect(() => {
    if (!host) return;
    const measure = () => setScale(host.getBoundingClientRect().width / CANVAS.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [host]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent, handle: Handle | 'move') => {
      event.preventDefault();
      // Stop the backdrop underneath from reading this as a click on empty
      // canvas and immediately clearing the selection we are about to make.
      event.stopPropagation();
      try {
        (event.target as Element).setPointerCapture?.(event.pointerId);
      } catch {
        /* dragging still works within the element */
      }

      // Selecting and dragging are one gesture: press to select, and keep
      // moving to drag. Making the first click select and a second click drag
      // would be a step nobody expects from a box on a canvas.
      onSelect();

      dragRef.current = {
        handle,
        startPointer: { x: event.clientX, y: event.clientY },
        startBox: { ...rect },
        aspect: rect.height === 0 ? 1 : rect.width / rect.height,
      };
      setDragging(true);
      onGrab?.();
    },
    [rect, onGrab, onSelect],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || scale === 0) return;
      event.preventDefault();

      const dx = (event.clientX - drag.startPointer.x) / scale;
      const dy = (event.clientY - drag.startPointer.y) / scale;
      const { startBox, handle } = drag;

      if (handle === 'move') {
        onChange({ ...startBox, x: startBox.x + dx, y: startBox.y + dy });
        return;
      }

      let { x, y, width, height } = startBox;
      if (handle.includes('w')) {
        width = Math.max(min.width, startBox.width - dx);
        x = startBox.x + startBox.width - width;
      }
      if (handle.includes('e')) width = Math.max(min.width, startBox.width + dx);
      if (handle.includes('n')) {
        height = Math.max(min.height, startBox.height - dy);
        y = startBox.y + startBox.height - height;
      }
      if (handle.includes('s')) height = Math.max(min.height, startBox.height + dy);

      // Corners hold proportions; hold Shift to break them. Edges always resize
      // one axis, which is what an edge handle means.
      const isCorner = handle.length === 2;
      if (isCorner && !event.shiftKey) {
        const byWidth = width / drag.aspect;
        const byHeight = height * drag.aspect;
        if (Math.abs(byWidth - height) < Math.abs(byHeight - width)) {
          height = Math.max(min.height, byWidth);
        } else {
          width = Math.max(min.width, byHeight);
        }
        if (handle.includes('w')) x = startBox.x + startBox.width - width;
        if (handle.includes('n')) y = startBox.y + startBox.height - height;
      }

      onChange({ x, y, width, height });
    },
    [onChange, min.width, min.height, scale],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const px = (value: number) => `${value * scale}px`;

  return (
    <div ref={setHost} className="image-stage">
      {scale > 0 ? (
        <div
          className={
            `stage-box stage-${variant}` +
            (selected ? '' : ' is-idle') +
            (dragging ? ' is-dragging' : '')
          }
          style={{
            left: px(rect.x),
            top: px(rect.y),
            width: px(rect.width),
            height: px(rect.height),
          }}
          onPointerDown={(event) => onPointerDown(event, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Handles and the readout belong to the selection, not to the
              object. Unselected, this element is a hit area and nothing more. */}
          {selected
            ? HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`stage-handle h-${handle}`}
                  style={{ cursor: CURSORS[handle] }}
                  onPointerDown={(event) => onPointerDown(event, handle)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))
            : null}
          {selected ? (
            <span className="stage-readout">
              {readout
                ? readout(rect)
                : `${Math.round(rect.width)} × ${Math.round(rect.height)}`}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
