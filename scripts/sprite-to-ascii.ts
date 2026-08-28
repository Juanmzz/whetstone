/**
 * `docs/assets/whetstone.png` to the half-block mark in `src/banner.ts`.
 *
 *   npx tsx scripts/sprite-to-ascii.ts [sprite] [cols]
 *
 * The mark is DERIVED from the sprite rather than copied by hand, so redrawing
 * one cannot silently leave the other behind. Handles the non-interlaced 8-bit
 * RGBA case, which is what the sprite is; anything else throws rather than
 * guessing.
 *
 * One terminal cell carries TWO pixels, upper and lower, so a cell that is about
 * twice as tall as it is wide holds two square ones. The alternative, one glyph
 * per cell with a luminance ramp, spends the same width on half the vertical
 * resolution and stretches every pixel.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

interface Image { w: number; h: number; px: Buffer }
type Rgb = [number, number, number];

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

/** Average a source rectangle. Returns null when it is mostly background. */
function sample(img: Image, x0: number, y0: number, x1: number, y1: number, bg: Rgb): Rgb | null {
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
  return [Math.round(r / off), Math.round(g / off), Math.round(b / off)];
}

const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dist2 = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Quantize to a small palette by k-means in RGB.
 *
 * Averaging a 94x96 source rectangle turns a sprite drawn in a handful of flat
 * tones into 133 near-duplicates, most of them one step apart along an edge.
 * A palette collapses that back to the tones actually drawn, and it is what
 * makes the emitted constant a grid of indices somebody can read as pixel art
 * rather than a wall of hex.
 */
function quantize(colors: readonly Rgb[], k: number): Rgb[] {
  const sorted = [...colors].sort((a, b) => lum(a) - lum(b));
  let centres: Rgb[] = Array.from({ length: k }, (_, i) =>
    sorted[Math.floor(((i + 0.5) / k) * sorted.length)] ?? sorted[0]!,
  );

  for (let pass = 0; pass < 40; pass++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const c of colors) {
      let best = 0;
      for (let i = 1; i < centres.length; i++) {
        if (dist2(c, centres[i]!) < dist2(c, centres[best]!)) best = i;
      }
      const s = sums[best]!;
      s[0]! += c[0]; s[1]! += c[1]; s[2]! += c[2]; s[3]!++;
    }
    centres = centres.map((c, i) => {
      const s = sums[i]!;
      return s[3]! === 0 ? c : ([Math.round(s[0]! / s[3]!), Math.round(s[1]! / s[3]!), Math.round(s[2]! / s[3]!)] as Rgb);
    });
  }

  // Darkest first, so the emitted palette reads as a ramp and a diff that
  // reorders it is visible rather than incidental.
  return centres.sort((a, b) => lum(a) - lum(b));
}

/** Index characters, in palette order. `.` is transparent. */
const DIGITS = "0123456789abcdefghijklmnopqrstuv";
const hex = (c: Rgb): string =>
  `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function emit(img: Image, cols: number, k: number): string[] {
  const bg: Rgb = [img.px[0] ?? 0, img.px[1] ?? 0, img.px[2] ?? 0];

  // Two pixels per cell, so the pixel is square: its width is one cell and its
  // height is half of one, and a cell is about twice as tall as it is wide.
  const rows = Math.max(1, Math.round((cols * img.h) / img.w / 2));
  const pxRows = rows * 2;
  const cw = img.w / cols, ph = img.h / pxRows;

  const grid: (Rgb | null)[][] = [];
  const opaque: Rgb[] = [];
  for (let r = 0; r < pxRows; r++) {
    const row: (Rgb | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const v = sample(img, c * cw, r * ph, (c + 1) * cw, (r + 1) * ph, bg);
      row.push(v);
      if (v !== null) opaque.push(v);
    }
    grid.push(row);
  }
  if (opaque.length === 0) throw new Error("the sprite sampled to nothing but background");

  const palette = quantize(opaque, Math.min(k, opaque.length));
  const indexOf = (c: Rgb): number => {
    let best = 0;
    for (let i = 1; i < palette.length; i++) {
      if (dist2(c, palette[i]!) < dist2(c, palette[best]!)) best = i;
    }
    return best;
  };

  console.error(`decoded ${String(img.w)}x${String(img.h)}`);
  console.error(`${String(cols)}x${String(pxRows)} pixels in ${String(rows)} rows`);
  console.error(`pixel ${(cw).toFixed(1)}x${(ph).toFixed(1)} source px`);
  console.error(`palette ${String(palette.length)}: ${palette.map(hex).join(" ")}`);

  const lines = [
    `export const MARK_PALETTE: readonly string[] = Object.freeze([`,
    ...palette.map((c) => `  "${hex(c)}",`),
    `]);`,
    ``,
    `export const MARK: Mark = decodeMark(MARK_PALETTE, [`,
    ...grid.map((row) => `  "${row.map((v) => (v === null ? "." : DIGITS[indexOf(v)]!)).join("")}",`),
    `]);`,
  ];
  return lines;
}

const img = decode(process.argv[2] ?? "docs/assets/whetstone.png");
const cols = Number(process.argv[3] ?? 30);
const k = Number(process.argv[4] ?? 8);
for (const line of emit(img, cols, k)) console.log(line);
