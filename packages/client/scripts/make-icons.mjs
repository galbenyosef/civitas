// Writes the PWA icons into public-local/ (docs/local-mode.md, phase F): node scripts/make-icons.mjs
// The favicon's mark (index.html): accent-green square, two dark towers. Plain PNG encoding with zlib, 4x4 supersampling for the edges.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public-local/', import.meta.url));
mkdirSync(out, { recursive: true });
const BG = [0x62, 0xd2, 0xa2], INK = [0x0e, 0x11, 0x16];

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size); // 0..1 square
        a += p[3]; r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = a / 16 * 255;
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** the towers, in a square of side `span` centred in the icon (maskable icons keep to the middle 80%) */
function mark(u, v, span) {
  const x = (u - 0.5) / span + 0.5, y = (v - 0.5) / span + 0.5; // back to the favicon's 16x16 space, /16
  const tower = (x0, y0, w, h) => x >= x0 / 16 && x < (x0 + w) / 16 && y >= y0 / 16 && y < (y0 + h) / 16;
  return tower(3, 6, 4, 7) || tower(9, 3, 4, 10);
}
const rounded = (u, v, r) => { // inside a rounded square of corner radius r (fraction)
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};
const icon = (span, round) => (u, v) => {
  if (round && !rounded(u, v, 0.1875)) return [0, 0, 0, 0];
  return [...(mark(u, v, span) ? INK : BG), 1];
};

const files = {
  'icon-192.png': png(192, icon(1, true)),
  'icon-512.png': png(512, icon(1, true)),
  'icon-maskable-512.png': png(512, icon(0.7, false)), // full bleed, the towers inside the safe zone
  'apple-touch-icon.png': png(180, icon(0.82, false)), // iOS rounds the corners itself
};
for (const [name, data] of Object.entries(files)) { writeFileSync(out + name, data); console.log(`${name} ${data.length} bytes`); }
