/**
 * Generates the PWA icons.
 *
 * A committed script rather than committed binaries someone would have to
 * trust: the mark is a blood drop, and how it is drawn is readable here. Run
 * `node scripts/make-icons.mjs` after changing it.
 *
 * Written with zlib and a hand-rolled PNG container so the repository gains no
 * image dependency for eight small files.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** UX4G red, from the shipped ramp. Kept in step with the design system. */
const RED = [0xc4, 0x1e, 0x1e];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = rgb(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A drop: a circle, with a cone rising from it to a point.
 *
 * `inset` leaves room for the safe area a maskable icon needs. A launcher may
 * crop up to 20% from every edge, and a mark drawn to the bezel loses its tip.
 */
function drop(size, inset) {
  const usable = size * (1 - inset * 2);
  const cx = size / 2;
  const top = size * inset;
  const bottom = size - size * inset;
  const radius = usable * 0.32;
  const cy = bottom - radius;

  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;

    // The bulb.
    const inCircle = (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;

    // The cone, narrowing linearly from the bulb's widest point to the apex.
    const t = (py - top) / (cy - top);
    const inCone = py >= top && py <= cy && Math.abs(px - cx) <= radius * t;

    return inCircle || inCone ? RED : WHITE;
  };
}

const targets = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  // Maskable icons are cropped by the launcher, so the mark sits well inside.
  ['icon-maskable-192.png', 192, 0.2],
  ['icon-maskable-512.png', 512, 0.2],
];

for (const app of ['web', 'admin']) {
  const dir = path.join(root, 'apps', app, 'public', 'icons');
  mkdirSync(dir, { recursive: true });

  for (const [name, size, inset] of targets) {
    writeFileSync(path.join(dir, name), png(size, size, drop(size, inset)));
  }

  // Favicon, at the size browsers actually rasterise in a tab.
  writeFileSync(path.join(dir, 'favicon-32.png'), png(32, 32, drop(32, 0.06)));
  console.log(`apps/${app}/public/icons: ${targets.length + 1} files`);
}
