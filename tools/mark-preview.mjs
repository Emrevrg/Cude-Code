// Renders assets/cude-mark.svg to a PNG so the mark can be eyeballed against
// the reference artwork without a browser.
//
// Usage: node tools/mark-preview.mjs [out.png] [size]

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { loadMark, makeInkTest } from './mark-raster.mjs';

const out = process.argv[2] ?? 'mark-preview.png';
const size = Number(process.argv[3] ?? 512);
const SS = 3; // supersampling, for smooth edges

const VIEWBOX = [0, 0, 512, 512];

const inked = makeInkTest(loadMark());

// Greyscale, one byte per pixel, filter byte 0 per row.
const raw = Buffer.alloc((size + 1) * size);
for (let y = 0; y < size; y++) {
  raw[y * (size + 1)] = 0;
  for (let x = 0; x < size; x++) {
    let hits = 0;
    for (let j = 0; j < SS; j++) {
      const sy = VIEWBOX[1] + ((y + (j + 0.5) / SS) / size) * VIEWBOX[3];
      for (let i = 0; i < SS; i++) {
        const sx = VIEWBOX[0] + ((x + (i + 0.5) / SS) / size) * VIEWBOX[2];
        if (inked(sx, sy)) hits++;
      }
    }
    raw[y * (size + 1) + 1 + x] = Math.round((hits / (SS * SS)) * 255);
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 0;   // colour type: greyscale
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
);

console.log(`wrote ${out} (${size}x${size})`);
