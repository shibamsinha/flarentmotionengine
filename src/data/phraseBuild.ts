/**
 * V8.3 — the phrase build.
 *
 * One sentence in, a run of ordinary scenes out.
 *
 * This is the pattern kinetic typography reaches for more than any other: a
 * sentence broken into phrases, each phrase revealed word by word, the pace
 * tightening as it goes, and the last word promoted to display size. Assembling
 * it by hand is six or eight scenes of near-identical settings — tedious in the
 * editor and a long chain of tool calls over MCP, and either way the *shape* of
 * the idea is buried in the repetition.
 *
 * **It is a constructor, not a mode.** Everything it returns is a plain `Scene`
 * built from `blankScene` and `element`, using the same roles, sizes, staggers
 * and animation styles an author could have typed. There is no phrase-build
 * flag on a scene, no special renderer path, and nothing downstream can tell a
 * built reel from a hand-made one. That is the whole design constraint: the
 * output has to stay editable, so it cannot be a template that owns its scenes.
 *
 * Its judgements — where to break, how to pace, what to promote — are the
 * *defaults*, and every one can be overridden or simply edited afterwards.
 */

import type { AnimationStyle, BackgroundName, Scene, SceneElement } from '../types/scene';
import { blankScene, element } from './defaultScenes';
import { splitWords } from '../utils/typography';

/**
 * How the cut lengths change across the build.
 *
 * `accelerate` is the interesting one and the reason pacing is a named intent
 * rather than a number: shortening each successive card is what makes a build
 * feel like it is arriving somewhere. `even` is the neutral option, and
 * `decelerate` opens fast and lets the last phrase breathe.
 */
export type PhrasePacing = 'even' | 'accelerate' | 'decelerate';

export type PhraseBuildOptions = {
  /** The whole sentence. Required. */
  sentence: string;
  /**
   * Explicit phrases, in order. When absent the sentence is broken on its own
   * punctuation, then by word count.
   */
  phrases?: string[];
  /** Total frames for the whole build. Ignored when `framesPerPhrase` is given. */
  totalFrames?: number;
  /** An exact cut list, one entry per phrase. Wins over `totalFrames`/`pacing`. */
  framesPerPhrase?: number[];
  /** How the cut lengths change. Default `accelerate`. */
  pacing?: PhrasePacing;
  /**
   * Give the final word its own card at display size. Default true — it is the
   * payoff the whole build is arriving at.
   */
  finalWordEmphasis?: boolean;
  /** Frames between words inside a phrase. Default 2. 0 turns the reveal off. */
  staggerFrames?: number;
  /** Frames each phrase's entrance takes. Default 2 — these are fast cards. */
  enterFrames?: number;
  /** The animation style for the phrase cards. Default `punch`. */
  style?: AnimationStyle;
  /** The final word's style, when it gets its own card. Default `massive`. */
  finalStyle?: AnimationStyle;
  /** The field the build runs on. Default `cream`. */
  background?: BackgroundName;
  /** Alternate the field every N frames on the final card. Off when absent. */
  finalStrobeFrames?: number;
  /** Fit every card to this share of the frame width. Off when absent. */
  fitWidth?: number;
};

/** What the build decided, alongside the scenes, so a caller can explain it. */
export type PhraseBuildResult = {
  scenes: Scene[];
  phrases: string[];
  framesPerPhrase: number[];
  finalWord: string | null;
};

/** Sensible floors — a card shorter than this is a flash, not a cut. */
const MIN_PHRASE_FRAMES = 3;
const DEFAULT_TOTAL_FRAMES = 90;

/**
 * Break a sentence into phrases.
 *
 * Punctuation first, because an author who wrote a comma has already said where
 * the phrase ends. Failing that, chunks of about three words — long enough to
 * be a phrase, short enough to read on a fast cut.
 */
export const splitPhrases = (sentence: string, wordsPerPhrase = 3): string[] => {
  const trimmed = sentence.trim();
  if (!trimmed) return [];

  const punctuated = trimmed
    .split(/(?<=[.,;:!?—])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (punctuated.length > 1) return punctuated;

  const words = splitWords(trimmed);
  if (words.length <= wordsPerPhrase) return [trimmed];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerPhrase) {
    chunks.push(words.slice(i, i + wordsPerPhrase).join(' '));
  }
  return chunks;
};

/**
 * Split a frame budget across phrases on a pacing curve.
 *
 * Distributed by weight and then corrected so the parts sum to *exactly* the
 * budget — the same discipline `distributeFrames` uses in the timing utilities,
 * and for the same reason: a build that lands one frame off its stated length
 * makes every later calculation slightly wrong.
 */
export const pacePhrases = (
  count: number,
  totalFrames: number,
  pacing: PhrasePacing = 'accelerate',
): number[] => {
  if (count <= 0) return [];
  const budget = Math.max(count * MIN_PHRASE_FRAMES, Math.round(totalFrames));

  // Weights run 1.0 → 0.55 for accelerate (each card a little shorter than the
  // last), the reverse for decelerate, and flat for even.
  const weights = Array.from({ length: count }, (_unused, i) => {
    if (pacing === 'even' || count === 1) return 1;
    const t = i / (count - 1);
    return pacing === 'accelerate' ? 1 - 0.45 * t : 0.55 + 0.45 * t;
  });

  const sum = weights.reduce((total, weight) => total + weight, 0);
  const raw = weights.map((weight) => (weight / sum) * budget);

  // Floor, clamp to the minimum, then hand any remainder to the longest cards
  // so rounding never lands on the shortest one and flattens the curve.
  const frames = raw.map((value) => Math.max(MIN_PHRASE_FRAMES, Math.floor(value)));
  let remainder = budget - frames.reduce((total, value) => total + value, 0);
  const order = frames
    .map((_value, i) => i)
    .sort((a, b) => raw[b] - raw[a]);
  let cursor = 0;
  while (remainder > 0) {
    frames[order[cursor % order.length]] += 1;
    remainder -= 1;
    cursor += 1;
  }
  while (remainder < 0) {
    const index = order[order.length - 1 - (cursor % order.length)];
    if (frames[index] > MIN_PHRASE_FRAMES) {
      frames[index] -= 1;
      remainder += 1;
    }
    cursor += 1;
    // Every card is already at the floor; the budget cannot shrink further.
    if (cursor > count * 4) break;
  }
  return frames;
};

/**
 * Build the scenes.
 *
 * The returned scenes are indistinguishable from hand-authored ones. Anything
 * here that looks like a decision — which word is promoted, how long each card
 * runs — is written into ordinary fields the editor already exposes, so the
 * first thing a user does after generating can be to change it.
 */
export const buildPhraseScenes = (options: PhraseBuildOptions): PhraseBuildResult => {
  const {
    sentence,
    pacing = 'accelerate',
    finalWordEmphasis = true,
    staggerFrames = 2,
    enterFrames = 2,
    style = 'punch',
    finalStyle = 'massive',
    background = 'cream',
    finalStrobeFrames,
    fitWidth,
  } = options;

  const phrases = (options.phrases?.length ? options.phrases : splitPhrases(sentence))
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  if (phrases.length === 0) {
    return { scenes: [], phrases: [], framesPerPhrase: [], finalWord: null };
  }

  /*
   * The payoff card.
   *
   * Taking the final word *out* of its phrase rather than duplicating it: the
   * build reads as arriving at that word, and showing it twice — once small in
   * the phrase, once large on its own — reads as a stutter. If removing it
   * would leave an empty card, the phrase keeps it and no payoff card is made.
   */
  const cards = [...phrases];
  let finalWord: string | null = null;

  if (finalWordEmphasis) {
    const lastIndex = cards.length - 1;
    const words = splitWords(cards[lastIndex]);
    if (words.length > 1) {
      finalWord = words[words.length - 1];
      cards[lastIndex] = words.slice(0, -1).join(' ');
    } else if (cards.length > 1) {
      // The last phrase is already a single word — promote the card itself.
      finalWord = cards.pop() as string;
    }
  }

  const cardCount = cards.length + (finalWord ? 1 : 0);
  const framesPerPhrase = options.framesPerPhrase?.length
    ? options.framesPerPhrase.slice(0, cardCount)
    : pacePhrases(cardCount, options.totalFrames ?? DEFAULT_TOTAL_FRAMES, pacing);

  // A short explicit list is padded from the pacing curve rather than refused:
  // "the first three cuts are 7, 8, 6" is a reasonable thing to mean.
  while (framesPerPhrase.length < cardCount) {
    framesPerPhrase.push(
      framesPerPhrase[framesPerPhrase.length - 1] ?? MIN_PHRASE_FRAMES,
    );
  }

  const fps = 30;
  const common = {
    background,
    enterFrames,
    ...(staggerFrames > 0
      ? { stagger: { type: 'word' as const, delayFrames: staggerFrames } }
      : {}),
    ...(fitWidth ? { fit: { mode: 'width' as const, maxWidth: fitWidth } } : {}),
  };

  const scenes: Scene[] = cards.map((text, index) =>
    blankScene({
      ...common,
      text,
      style,
      duration: framesPerPhrase[index] / fps,
    }),
  );

  if (finalWord) {
    const elements: SceneElement[] = [
      element(finalWord, { role: 'emphasis', size: 'oversized', case: 'upper' }),
    ];
    scenes.push(
      blankScene({
        ...common,
        text: finalWord,
        style: finalStyle,
        duration: framesPerPhrase[cardCount - 1] / fps,
        // The payoff is the one card that should be *read*, so it holds rather
        // than staggering, and it is emphasised in the scene's own vocabulary.
        stagger: undefined,
        emphasis: [finalWord],
        elements,
        ...(finalStrobeFrames
          ? {
              backgroundMotion: {
                mode: 'alternate' as const,
                everyFrames: finalStrobeFrames,
              },
            }
          : {}),
      }),
    );
  }

  return { scenes, phrases, framesPerPhrase, finalWord };
};
