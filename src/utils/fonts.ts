/**
 * Font loading.
 *
 * Faces are served from `public/fonts` so the Vite preview and the headless
 * render use byte-identical files — no network at render time, and no "the
 * export doesn't match the preview".
 *
 * Loading state is a module-level singleton: once the faces are live nothing
 * creates another delayRender handle, so scene changes during a render stay
 * free.
 */

import { loadFont } from '@remotion/fonts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';
import { FONT_FACES, FONT_FAMILY } from './typography';

let ready = false;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const announce = () => {
  ready = true;
  listeners.forEach((listener) => listener());
};

export const loadFlarentFonts = (): Promise<void> => {
  if (ready) return Promise.resolve();
  if (!pending) {
    pending = Promise.all(
      FONT_FACES.map((face) =>
        loadFont({
          family: FONT_FAMILY,
          url: staticFile(face.file),
          weight: String(face.weight),
          style: 'normal',
          format: 'woff2',
        }),
      ),
    )
      .then(() => document.fonts.ready)
      .then(() => {
        announce();
      })
      .catch((error) => {
        // Never wedge a render on a font problem — fall back to the CSS stack.
        // eslint-disable-next-line no-console
        console.error('[flarent] font load failed', error);
        announce();
      });
  }
  return pending;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): boolean => ready;

/**
 * True once the typeface is measurable. Holds back Remotion's frame capture
 * on the very first mount so no frame is ever laid out against a fallback font.
 */
export const useFontsReady = (): boolean => {
  const isReady = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [handle] = useState<number | null>(() =>
    ready ? null : delayRender('Loading Flarent typeface'),
  );

  useEffect(() => {
    let released = false;
    void loadFlarentFonts().then(() => {
      if (released || handle === null) return;
      released = true;
      continueRender(handle);
    });
    return () => {
      if (released || handle === null) return;
      released = true;
      continueRender(handle);
    };
  }, [handle]);

  return isReady;
};
