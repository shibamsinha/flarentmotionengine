/**
 * Minimal PNG read/write, for compositing contact sheets.
 *
 * Written rather than shelled out to, for the reason the audio decoder already
 * established: Remotion's bundled ffmpeg is a reduced build, and the filters
 * that would tile images (`rawvideo`, `tile`) are among the things it does not
 * carry. Depending on a full system ffmpeg would make the feature work or fail
 * according to what happens to be installed on the machine.
 *
 * Scope is exactly what `renderStill` emits and what a contact sheet needs:
 * 8-bit RGB/RGBA, non-interlaced, read; 8-bit RGB written. Anything else throws
 * loudly rather than producing a plausible-looking wrong image.
 *
 * `test/png.mjs` is the same decoder for the test suite. The duplication is
 * deliberate and small: this file is server runtime and that one is test-only,
 * and making the render server import out of `test/` would be worse than sixty
 * shared lines.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import fs from 'node:fs';

const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* --------------------------------------------------------------------- crc */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/* -------------------------------------------------------------------- read */

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** Decode a PNG file to `{ width, height, channels, data }`. */
export const readPng = (file) => {
  const buffer = fs.readFileSync(file);
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error(`${file} is not a PNG.`);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = offset + 8;

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(body);
      height = buffer.readUInt32BE(body + 4);
      bitDepth = buffer[body + 8];
      colorType = buffer[body + 9];
      if (buffer[body + 12] !== 0) throw new Error('Interlaced PNGs are not supported.');
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(body, body + length));
    } else if (type === 'IEND') break;

    offset = body + length + 4;
  }

  if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${bitDepth}).`);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}.`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x];
      const left = x >= channels ? data[target + x - channels] : 0;
      const up = y > 0 ? data[target - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[target - stride + x - channels] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paeth(left, up, upLeft); break;
        default: throw new Error(`Unknown PNG filter ${filter} on row ${y}.`);
      }
      data[target + x] = restored & 0xff;
    }
  }

  return { width, height, channels, data };
};

/* ------------------------------------------------------------------- write */

const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
};

/**
 * Write 8-bit RGB as a PNG.
 *
 * Filter type 0 (none) on every row. A real encoder would try each filter per
 * row and keep the smallest; a contact sheet is written once, read once and
 * deleted, so the compression is not worth the code.
 */
export const writePng = (file, { width, height, data }) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour RGB
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  fs.writeFileSync(file, Buffer.concat([
    MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
};

/* --------------------------------------------------------------- compositing */

/** A blank RGB canvas filled with one colour. */
export const canvas = (width, height, [r, g, b]) => {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { width, height, data };
};

/**
 * Draw one image into another, box-sampled down to `w` × `h`.
 *
 * Nearest-neighbour would alias a 1080-wide frame into a 300-wide cell badly
 * enough to misrepresent the type — thin strokes would drop out entirely, and
 * the whole point of a contact sheet is judging what the type looks like. Box
 * sampling averages the source pixels each cell covers, which is cheap and
 * enough at these ratios.
 */
export const drawScaled = (target, source, x, y, w, h) => {
  const sx = source.width / w;
  const sy = source.height / h;
  const sc = source.channels;

  for (let row = 0; row < h; row++) {
    const y0 = Math.floor(row * sy);
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * sy));
    const ty = y + row;
    if (ty < 0 || ty >= target.height) continue;

    for (let col = 0; col < w; col++) {
      const x0 = Math.floor(col * sx);
      const x1 = Math.max(x0 + 1, Math.floor((col + 1) * sx));
      const tx = x + col;
      if (tx < 0 || tx >= target.width) continue;

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let py = y0; py < Math.min(y1, source.height); py++) {
        for (let px = x0; px < Math.min(x1, source.width); px++) {
          const at = py * source.width * sc + px * sc;
          r += source.data[at];
          g += source.data[at + 1];
          b += source.data[at + 2];
          n += 1;
        }
      }
      if (n === 0) continue;
      const to = ty * target.width * 3 + tx * 3;
      target.data[to] = Math.round(r / n);
      target.data[to + 1] = Math.round(g / n);
      target.data[to + 2] = Math.round(b / n);
    }
  }
};

/** A filled rectangle — used for the separators between cells. */
export const fillRect = (target, x, y, w, h, [r, g, b]) => {
  for (let row = y; row < Math.min(y + h, target.height); row++) {
    if (row < 0) continue;
    for (let col = x; col < Math.min(x + w, target.width); col++) {
      if (col < 0) continue;
      const at = row * target.width * 3 + col * 3;
      target.data[at] = r;
      target.data[at + 1] = g;
      target.data[at + 2] = b;
    }
  }
};
