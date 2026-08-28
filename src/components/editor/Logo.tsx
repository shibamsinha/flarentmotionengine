/**
 * The Flarent lockup.
 *
 * The supplied asset, not a redrawing of it. `public/brand/logo.png` is the
 * original 2000×2000 export and stays as the source of truth; the two files
 * used here are tight crops of it at 3× the on-screen size, so they are crisp
 * on a retina display without shipping 174 KB into a 26px-tall navbar.
 *
 * Regenerate the crops from the source with `scripts/brand-crop.mjs` if the
 * asset is ever replaced.
 *
 * The wordmark in the asset is near-white (#F0F0F0), which is why it reads on
 * the editor's near-black chrome without any treatment.
 */

import React from 'react';

/** Mark only. Aspect 1.038. */
export const LOGO_MARK = '/brand/logo-mark.png';
/** Mark + wordmark. Aspect 5.744. */
export const LOGO_LOCKUP = '/brand/logo-lockup.png';
/**
 * The wordmark alone, reading "Flarent Motion Engine" — one word longer than
 * the brand lockup above, which stops at "Flarent Motion". Cut from the
 * approved splash animation by `scripts/splash-wordmark.mjs` because the brand
 * typeface has never been supplied; see that script for why. White with alpha,
 * so it takes its colour from whatever it sits on. Aspect 9.116.
 */
export const SPLASH_WORDMARK = '/brand/splash-wordmark.png';

export const Logo: React.FC = () => (
  <div className="logo">
    {/*
      Both are rendered and CSS picks one, rather than measuring the window in
      JS: a media query swaps them without a resize listener or a reflow, and
      the second image is a few KB.
    */}
    <img className="logo-lockup" src={LOGO_LOCKUP} alt="Flarent Motion" />
    <img className="logo-mark" src={LOGO_MARK} alt="Flarent Motion" />
  </div>
);
