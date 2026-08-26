/**
 * `docs/assets/whetstone.png` to block ASCII.
 *
 *   npx tsx scripts/sprite-to-ascii.ts [cols]
 *
 * The mark is DERIVED from the sprite rather than copied by hand, so redrawing
 * one cannot silently leave the other behind. Handles the non-interlaced 8-bit
 * RGBA case, which is what the sprite is; anything else throws rather than
 * guessing.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

interface Image { w: number; h: number; px: Buffer }

function decode(path: string): Image {
  const b = readFileSync(path);
  if (b.subarray(1, 4).toString() !== "PNG") throw new Error("not a PNG");

  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const depth = b[24], color = b[25], interlace = b[28];
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`unsupported: depth ${String(depth)} color ${String(color)} interlace ${String(interlace)}`);
  }

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
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x] ?? 0;
      const a = x >= bpp ? (px[dst + x - bpp] ?? 0) : 0;            // left
      const c = y > 0 ? (px[dst - stride + x] ?? 0) : 0;            // up
      const d = y > 0 && x >= bpp ? (px[dst - stride + x - bpp] ?? 0) : 0; // up-left
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
        default: throw new Error(`bad filter ${String(filter)} on row ${String(y)}`);
      }
      px[dst + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Average a source rectangle. Returns null when it is mostly background. */
function sample(img: Image, x0: number, y0: number, x1: number, y1: number, bg: [number, number, number]) {
  let r = 0, g = 0, b = 0, n = 0, off = 0;
  for (let y = Math.floor(y0); y < Math.min(Math.ceil(y1), img.h); y++) {
    for (let x = Math.floor(x0); x < Math.min(Math.ceil(x1), img.w); x++) {
      const i = (y * img.w + x) * 4;
      const R = img.px[i] ?? 0, G = img.px[i + 1] ?? 0, B = img.px[i + 2] ?? 0, A = img.px[i + 3] ?? 0;
      n++;
      if (A < 128) continue;
      const near = Math.abs(R - bg[0]) + Math.abs(G - bg[1]) + Math.abs(B - bg[2]) < 30;
      if (near) continue;
      off++; r += R; g += G; b += B;
    }
  }
  if (n === 0 || off / n < 0.5) return null;
  return lum(r / off, g / off, b / off);
}

const GLYPHS = ["█", "▓", "▒", "░"] as const; // darkest to lightest

function toAscii(img: Image, cols: number): string[] {
  const i0 = 0;
  const bg: [number, number, number] = [img.px[i0] ?? 0, img.px[i0 + 1] ?? 0, img.px[i0 + 2] ?? 0];

  // one char per cell; a char is about half as wide as it is tall
  const rows = Math.max(1, Math.round((cols * img.h) / img.w / 2));
  const cw = img.w / cols, ch = img.h / rows;

  const cells: (number | null)[][] = [];
  const vals: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const v = sample(img, c * cw, r * ch, (c + 1) * cw, (r + 1) * ch, bg);
      row.push(v);
      if (v !== null) vals.push(v);
    }
    cells.push(row);
  }

  if (vals.length === 0) return ["(todo fondo)"];

  // Four clusters by 1-D k-means, not quartiles. Quartiles force a quarter of the
  // cells into each glyph, which speckles a face that is genuinely one flat tone.
  vals.sort((a, b) => a - b);
  let centres = [0.125, 0.375, 0.625, 0.875].map((p) => vals[Math.floor(p * (vals.length - 1))]!);
  for (let pass = 0; pass < 24; pass++) {
    const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0];
    for (const v of vals) {
      let best = 0;
      for (let k = 1; k < 4; k++) {
        if (Math.abs(v - centres[k]!) < Math.abs(v - centres[best]!)) best = k;
      }
      sums[best]! += v; counts[best]!++;
    }
    centres = centres.map((c, k) => (counts[k]! > 0 ? sums[k]! / counts[k]! : c));
  }

  const glyphFor = (v: number): string => {
    let best = 0;
    for (let k = 1; k < 4; k++) {
      if (Math.abs(v - centres[k]!) < Math.abs(v - centres[best]!)) best = k;
    }
    return GLYPHS[best]!;
  };

  console.error("  tonos:", centres.map((c) => Math.round(c)).join(" · "));

  return cells.map((row) =>
    row.map((v) => (v === null ? " " : glyphFor(v))).join("").replace(/\s+$/, ""),
  );
}

const img = decode(process.argv[2] ?? "docs/assets/whetstone.png");
console.error(`decoded ${String(img.w)}x${String(img.h)}`);
const cols = Number(process.argv[3] ?? 40);
for (const line of toAscii(img, cols)) console.log(line);
