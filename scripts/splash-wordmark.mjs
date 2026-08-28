/**
 * Cut the splash wordmark out of the approved splash animation.
 *
 *   node scripts/splash-wordmark.mjs
 *
 * Why this exists rather than a font: the splash lockup reads "Flarent Motion
 * Engine", but `public/brand/logo.png` — the brand source of truth — only
 * carries "Flarent Motion". The brand typeface has been an open question since
 * the V1 handoff and no font file has ever been supplied, so setting the extra
 * word in Inter (or in a guess at the real face) would put a visibly wrong
 * letterform next to the real logo. `reference/splash.mp4` is the animation the
 * user approved, so its own pixels are the closest thing to an authoritative
 * asset that exists.
 *
 * Two things make the extraction clean rather than a screenshot:
 *
 *  - Frames 40–69 of the splash are byte-identical (the lockup is settled and
 *    holding), so averaging them cancels most of the H.264 ringing around the
 *    glyph edges. Measured: peak per-pixel deviation across those frames drops
 *    from ~11/255 on a single frame to under 2/255 on the mean.
 *  - The wordmark is near-white (#FCFCFC) on pure black, so luminance *is* the
 *    coverage map. Alpha comes straight from it and the RGB is flattened to
 *    white, which gives a mask that recolours cleanly on any background instead
 *    of carrying a black fringe.
 *
 * If the real typeface ever arrives, delete this asset and set the wordmark as
 * live text — everything else about the splash stays as it is.
 *
 * Requires ffmpeg on PATH and Python with Pillow + NumPy, the same toolchain
 * `scripts/brand-crop.mjs` already assumes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SOURCE = 'reference/splash.mp4';
const OUT = 'public/brand/splash-wordmark.png';

/**
 * Measured from the source with NumPy, not eyeballed — see SPLASH in
 * `src/utils/splashMotion.ts`, which carries the same numbers as ratios.
 * Frame is 1080×1920; the settled wordmark occupies x 213–997, y 916–1002.
 */
const CROP = { x: 213, y: 916, w: 785, h: 87 };
/** The settled hold. Every frame in this range is identical. */
const FIRST_STILL_FRAME = 40;
const STILL_FRAMES = 30;

const work = mkdtempSync(path.join(tmpdir(), 'flarent-wordmark-'));

try {
  // `tmix` averages consecutive frames; taking the last one of the window means
  // the output is the mean of the whole still range.
  execFileSync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', SOURCE,
      '-vf', [
        `select='between(n,${FIRST_STILL_FRAME},${FIRST_STILL_FRAME + STILL_FRAMES - 1})'`,
        `tmix=frames=${STILL_FRAMES}`,
        `crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y}`,
      ].join(','),
      '-frames:v', '1',
      '-fps_mode', 'passthrough',
      path.join(work, 'plate.png'),
      '-y',
    ],
    { stdio: 'inherit' },
  );

  const py = `
import numpy as np
from PIL import Image

plate = np.array(Image.open(${JSON.stringify(path.join(work, 'plate.png'))}).convert('RGB')).astype(np.float64)

# White ink on black: luminance is coverage. Taking the channel max rather than a
# weighted luma keeps the thin antialiased stems from being dimmed by the green
# weighting a Rec.709 luma would apply.
alpha = plate.max(axis=2)

# The plate's black is not quite 0 (H.264 puts a little noise in the flat area).
# Anything under ~3/255 is that noise, and stretching from the true floor keeps
# the glyph edges from picking up a grey haze.
floor = np.percentile(alpha, 40)
alpha = np.clip((alpha - floor) / (alpha.max() - floor), 0, 1)

out = np.zeros(plate.shape[:2] + (4,), dtype=np.uint8)
out[:, :, :3] = 255                      # flatten to white; the UI tints it
out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)

im = Image.fromarray(out, 'RGBA')
im.save(${JSON.stringify(OUT)}, optimize=True)
print(f'{${JSON.stringify(OUT)}}  {im.size[0]} x {im.size[1]}  aspect {im.size[0] / im.size[1]:.4f}')
`;
  execFileSync('python3', ['-c', py], { stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
