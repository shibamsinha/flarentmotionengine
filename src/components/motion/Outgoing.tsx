/**
 * The previous scene's type, leaving.
 *
 * Rendered inside the *incoming* scene for the first few frames of it, which is
 * what produces the overlap without any sequence actually overlapping — the
 * timeline is untouched and the film's length is unchanged.
 *
 * Words that the incoming scene is carrying are not drawn here: their incoming
 * copy travels from the old position instead, so drawing them twice would
 * double the ink for a few frames.
 *
 * V3: a scene may leave as several pieces at once, each under its own style and
 * its own role amplitude. A MASSIVE hero and its SUPPORT caption should not
 * exit identically merely because they shared a frame.
 */

import React from 'react';
import type { ScenePlan } from '../../utils/plan';
import type { SceneTransition } from '../../utils/transition';
import { exitPiecesOf, exitSpecFor } from '../../utils/transition';
import { BLUR_GAIN, velocityBlur } from '../../utils/motionBlur';
import { MotionSpan, TypeBlock, amplify, exitValues } from './primitives';
import { resolveStyle } from '../../utils/visualStyle';
import type { Theme } from '../../utils/typography';

const SOLID = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 };
const GONE = { opacity: 0, x: 0, y: 0, scale: 1, blur: 0, rotate: 0 };

export const Outgoing: React.FC<{
  plan: ScenePlan;
  transition: SceneTransition;
  /** Frame local to the incoming scene, i.e. frames since the boundary. */
  frame: number;
  color: string;
  /**
   * The *incoming* scene's theme. The outgoing type is already on the new field
   * — that is what V2's seam does — so it has to be re-painted to stay legible,
   * exactly as its ink colour already was.
   */
  theme: Theme;
}> = ({ plan, transition, frame, color, theme }) => {
  if (transition.frames <= 0 || frame >= transition.frames) return null;
  if (transition.exiting.length === 0) return null;

  const leaving = new Set(transition.exiting.map((word) => word.id));

  return (
    <>
      {exitPiecesOf(plan).map((piece, index) => {
        if (piece.block.lines.length === 0) return null;
        // Nothing in this piece is leaving — every word of it is being carried
        // by the incoming scene, which will draw them itself.
        if (!piece.block.lines.some((line) => line.words.some((w) => leaving.has(w.id))))
          return null;

        const spec = exitSpecFor(piece.style, transition.frames, transition.fieldChanges);
        const gain = BLUR_GAIN[piece.style] ?? 1;
        const visual = resolveStyle(piece.visual, theme);

        // One motion for the whole piece: it left as a composition, not as a
        // set of independent words.
        const at = (f: number) => amplify(exitValues(f, spec), piece.motion);

        return (
          <TypeBlock
            key={`${piece.block.lines[0]?.id ?? 'piece'}-${index}`}
            block={piece.block}
            color={color}
            visual={visual}
            values={at(frame)}
            blur={velocityBlur(at, frame, piece.block.heroSize, gain)}
            renderWord={(word, _line, glyph) =>
              leaving.has(word.id) ? (
                <MotionSpan values={SOLID}>{glyph}</MotionSpan>
              ) : (
                // Carried by the incoming scene — hidden here, but kept in the
                // flow so the words that *are* leaving keep their positions.
                <MotionSpan values={GONE} style={{ visibility: 'hidden' }}>
                  {glyph}
                </MotionSpan>
              )
            }
          />
        );
      })}
    </>
  );
};
