/**
 * STYLE 06 — NONE
 *
 * Type that does not move.
 *
 * **This is a real no-motion path, not a very short animation.** Every frame
 * returns `IDENTITY`, so nothing is translated, scaled, faded or blurred, and
 * the element is fully opaque from its first frame. That distinction matters:
 * a one-frame PUNCH still crosses 100% and still burns off a blur, which reads
 * as a pop at the cut. A held card has to be genuinely still or the eye catches
 * the settle.
 *
 * Why it belongs in the vocabulary at all: a great deal of kinetic typography
 * gets its rhythm from the *cut*, not from movement — a static line over a
 * changing field, or a hard cut between two held cards. Without `none` the
 * engine could animate but could not hold, which meant every scene had to move
 * whether the design wanted it to or not.
 *
 * `frames: 0` is the signal to `StyleBlock` that there is no entrance window at
 * all, which is what also suppresses the offscreen-origin travel that every
 * other style decays over its own entrance.
 */

import React from 'react';
import { IDENTITY, StyleBlock, type MotionProps } from './primitives';

export const Static: React.FC<MotionProps> = ({
  element,
  frame,
  color,
  visual,
  transition,
}) => (
  <StyleBlock
    element={element}
    frame={frame}
    color={color}
    visual={visual}
    transition={transition}
    motion={{
      // Zero, not one: `StyleBlock` reads this as "no entrance window".
      frames: 0,
      block: () => IDENTITY,
      word: () => IDENTITY,
      // No movement means no motion blur to gain up.
      gain: 0,
    }}
  />
);
