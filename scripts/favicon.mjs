/**
 * Regenerate the browser icons from the brand asset.
 *
 *   node scripts/favicon.mjs
 *
 * Source is `public/brand/logo.png`, the same 2000×2000 export everything else
 * brand-related is cut from. The mark there measures 268×258 of real ink; the
 * standalone `favicon.png` that was supplied carries the identical artwork
 * (mean alpha difference 3.9/255, i.e. resampling noise) but only 68×64 of it
 * inside a 500px canvas, so cutting from the logo gives four times the
 * resolution for free. One source of truth, and the icons stay correct if the
 * logo is ever replaced.
 *
 * Emitted:
 *
 *   favicon.ico            16/32/48, for the bare `/favicon.ico` browsers
 *                          request when nothing is declared
 *   favicon.png            512, the modern `rel="icon"`
 *   apple-touch-icon.png   180, opaque
 *
 * **Fill.** The mark is scaled to 88% of the tile rather than dropped in at its
 * source proportions. At 16px a favicon has ~16 usable pixels; the supplied
 * file's 13% fill would have left the mark about two pixels across. The Apple
 * icon uses 68% instead, because iOS rounds the corners and crops slightly, and
 * a tight mark loses its ends to that.
 *
 * **Transparency.** The .ico and .png keep the transparent background so the
 * green sits on whatever the browser's tab strip is, light or dark. The Apple
 * icon cannot: iOS composites transparency onto black, so it is given the
 * editor's own `--bg` (#0c0d0c) deliberately rather than by accident.
 *
 * Requires Python with Pillow + NumPy, the same toolchain `brand-crop.mjs` and
 * `splash-wordmark.mjs` already assume.
 */
import { execFileSync } from 'node:child_process';

const py = `
import numpy as np
from PIL import Image

src = Image.open('public/brand/logo.png').convert('RGBA')
alpha = np.array(src)[:, :, 3]
mask = alpha > 8

# The mark is the first run of ink columns; the wordmark follows after a gap.
cols = mask.sum(axis=0)
runs, start = [], None
for x, v in enumerate(cols):
    if v > 0 and start is None: start = x
    elif v == 0 and start is not None: runs.append((start, x - 1)); start = None
if start is not None: runs.append((start, len(cols) - 1))

x0, x1 = runs[0]
band = mask.copy(); band[:, :x0] = False; band[:, x1 + 1:] = False
ys, xs = np.where(band)
mark = src.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
print(f'mark cut from logo.png: {mark.size[0]}x{mark.size[1]}')

def tile(size, fill, background=None):
    """Mark centred in a square, scaled to \`fill\` of the tile's shorter side."""
    target = size * fill
    scale = min(target / mark.width, target / mark.height)
    w, h = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    art = mark.resize((w, h), Image.LANCZOS)

    canvas = Image.new('RGBA', (size, size), background or (0, 0, 0, 0))
    # alpha_composite rather than paste: paste would punch the mark's own
    # transparent corners through an opaque background.
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    layer.paste(art, ((size - w) // 2, (size - h) // 2))
    return Image.alpha_composite(canvas, layer)

tile(512, 0.88).save('public/favicon.png', optimize=True)
tile(180, 0.68, (12, 13, 12, 255)).convert('RGB').save(
    'public/apple-touch-icon.png', optimize=True)
# Pillow writes a genuine multi-resolution .ico from one image.
tile(256, 0.88).save('public/favicon.ico',
                     sizes=[(16, 16), (32, 32), (48, 48)])

for name in ('favicon.ico', 'favicon.png', 'apple-touch-icon.png'):
    im = Image.open(f'public/{name}')
    print(f'  public/{name:22} {im.size[0]}x{im.size[1]}  {im.mode}')
`;

execFileSync('python3', ['-c', py], { stdio: 'inherit' });
