/**
 * Regenerate the navbar logo crops from the supplied brand asset.
 *
 *   node scripts/brand-crop.mjs
 *
 * `public/brand/logo.png` is the source of truth — a 2000x2000 export that is
 * mostly empty canvas. This trims it to its ink, twice: the full lockup and the
 * mark on its own, both at 3x the on-screen height so they stay crisp on a
 * retina display without shipping the full file into a 22px-tall bar.
 *
 * Requires Python with Pillow, which is how the crops were originally cut.
 */
import { execFileSync } from 'node:child_process';

const py = `
import numpy as np, os
from PIL import Image
src = Image.open('public/brand/logo.png').convert('RGBA')
a = np.array(src); alpha = a[:, :, 3]

def bbox(x0=None, x1=None):
    m = alpha > 8
    if x0 is not None:
        m = m.copy(); m[:, :x0] = False; m[:, x1 + 1:] = False
    ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

H = 78  # 3x the 22px navbar height, with headroom

# The mark is the first run of ink; the wordmark follows after a gap.
cols = (alpha > 8).sum(axis=0)
runs, start = [], None
for x, v in enumerate(cols):
    if v > 0 and start is None: start = x
    elif v == 0 and start is not None: runs.append((start, x - 1)); start = None
if start is not None: runs.append((start, len(cols) - 1))

for name, box in (('logo-lockup.png', bbox()), ('logo-mark.png', bbox(*runs[0]))):
    im = src.crop(box)
    im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
    im.save(f'public/brand/{name}', optimize=True)
    print(f"{name:18} {im.size[0]:>4} x {im.size[1]:<4} aspect {im.width / im.height:.3f}")
`;
execFileSync('python3', ['-c', py], { stdio: 'inherit' });
