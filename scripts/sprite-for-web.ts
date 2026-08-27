/**
 * The hero image, from the same sprite the ASCII mark comes from.
 *
 *   npx tsx scripts/sprite-for-web.ts docs/assets/whetstone.png docs/assets/whetstone-web.png 4
 *
 * Nearest-neighbour, never averaged: averaging invents colours between hard
 * edges, which is the one thing pixel art must not have. The source stays at
 * full size because `sprite-to-ascii.ts` derives the terminal mark from it and
 * a resample shifts two rows of that.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

function decode(path: string): { w: number; h: number; px: Buffer } {
  const b = readFileSync(path);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 6 || b[28] !== 0) throw new Error("only 8-bit RGBA, non-interlaced");

  const parts: Buffer[] = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.subarray(off + 4, off + 8).toString();
    if (type === "IDAT") parts.push(b.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x] ?? 0;
      const a = x >= bpp ? (px[dst + x - bpp] ?? 0) : 0;
      const c = y > 0 ? (px[dst - stride + x] ?? 0) : 0;
      const d = y > 0 && x >= bpp ? (px[dst - stride + x - bpp] ?? 0) : 0;
      let v: number;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + c; break;
        case 3: v = cur + ((a + c) >> 1); break;
        case 4: {
          const p = a + c - d;
          const pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - d);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d);
          break;
        }
        default: throw new Error(`bad filter ${String(filter)}`);
      }
      px[dst + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encode(w: number, h: number, px: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // no filter: flat art deflates well without one
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const [, , input, output, factorArg] = process.argv;
const factor = Number(factorArg ?? 4);
const img = decode(input!);
const w = Math.floor(img.w / factor), h = Math.floor(img.h / factor);
const out = Buffer.alloc(w * h * 4);

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const src = ((y * factor) * img.w + x * factor) * 4;
    img.px.copy(out, (y * w + x) * 4, src, src + 4);
  }
}

writeFileSync(output!, encode(w, h, out));
console.log(`${String(img.w)}x${String(img.h)} -> ${String(w)}x${String(h)}`);
