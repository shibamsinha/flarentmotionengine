/**
 * The one place a glyph gets painted.
 *
 * Animation components receive this already built and drop it inside their
 * `<MotionSpan>` — they never see a colour, a stroke or a gradient. That is the
 * V4 architectural rule: five animations × four styles is twenty combinations
 * and zero extra components, because the two systems only meet here.
 *
 * GRADIENT is `background-clip: text`, which Chrome supports and Remotion
 * renders through headless Chrome — verified in an exported MP4, not assumed.
 * The gradient box is the whole *element*, not the word, so a ramp runs
 * continuously across "MORE CUSTOMERS" instead of restarting on every word.
 * That is what `box` carries.
 *
 * OUTLINE is `-webkit-text-stroke` with a transparent fill. It scales with the
 * type because the weight is a ratio, so an OVERSIZED word keeps a real stroke
 * and a caption does not get a slab.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { styleCss, type GlyphBox, type ResolvedStyle } from '../../utils/visualStyle';

export type { GlyphBox };

const paintCss = (
  style: ResolvedStyle,
  fontSize: number,
  box: GlyphBox,
): CSSProperties => styleCss(style, fontSize, box) as CSSProperties;

/**
 * Two treatments across one run of glyphs.
 *
 * The word is drawn once per part and each copy is clipped to a vertical band.
 * Splitting the string into per-character spans would be the obvious approach
 * and it is the wrong one: it discards kerning and re-flows the word, so SPLIT
 * type would not sit where the planner measured it. Clipping leaves the
 * typography untouched and only changes what is painted where.
 */
const LetterSplit: React.FC<{
  text: string;
  parts: ResolvedStyle[];
  fontSize: number;
  box: GlyphBox;
}> = ({ text, parts, fontSize, box }) => (
  <span style={{ position: 'relative', display: 'inline-block' }}>
    {parts.map((part, index) => {
      const from = (index / parts.length) * 100;
      const to = ((index + 1) / parts.length) * 100;
      const clip = `inset(-25% ${(100 - to).toFixed(4)}% -35% ${from.toFixed(4)}%)`;
      return (
        <span
          key={index}
          aria-hidden={index > 0}
          style={{
            ...paintCss(part, fontSize, box),
            clipPath: clip,
            // The first copy stays in flow and defines the layout; the rest are
            // stacked exactly over it.
            ...(index === 0
              ? { display: 'inline-block' }
              : { position: 'absolute', left: 0, top: 0, display: 'inline-block' }),
          }}
        >
          {text}
        </span>
      );
    })}
  </span>
);

export const StyledText: React.FC<{
  text: string;
  style: ResolvedStyle;
  fontSize: number;
  box: GlyphBox;
  /** Index of this word within its element, for SPLIT's word cycling. */
  wordIndex: number;
  /** How many words the element has, for `splitBy: 'auto'`. */
  wordCount: number;
}> = ({ text, style, fontSize, box, wordIndex, wordCount }) => {
  if (style.type === 'split' && style.parts.length > 0) {
    const byLetter =
      style.splitBy === 'letter' ||
      // A one-word element cannot be split across words, and the brief's own
      // example — MO / RE — is exactly that case.
      (style.splitBy === 'auto' && wordCount <= 1);

    if (byLetter) {
      return (
        <LetterSplit text={text} parts={style.parts} fontSize={fontSize} box={box} />
      );
    }

    const part = style.parts[wordIndex % style.parts.length];
    return <span style={paintCss(part, fontSize, box)}>{text}</span>;
  }

  return <span style={paintCss(style, fontSize, box)}>{text}</span>;
};
