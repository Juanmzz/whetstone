/**
 * The mark as pixels, and the escape sequences that draw it. PURE.
 *
 * One terminal cell is TWO pixels: `▀` paints its foreground over the upper half
 * and its background over the lower one. A cell is about twice as tall as it is
 * wide, so the two pixels come out square, and the same thirty columns carry
 * sixteen pixel rows instead of eight stretched ones.
 *
 * The alternative it replaces was one glyph per cell chosen from `█▓▒░`, which
 * spends a whole cell on one pixel and encodes its brightness as a dither
 * pattern rather than a colour.
 */

export type Rgb = readonly [number, number, number];

/** One cell: the pixel it draws on top of the other. `null` is transparent. */
export interface Cell {
  readonly top: Rgb | null;
  readonly bottom: Rgb | null;
}

export type Mark = readonly (readonly Cell[])[];

/** What the terminal can actually show. See `shell/color.ts` for how it is read. */
export type ColorDepth = "truecolor" | "ansi256" | "none";

const UPPER = "▀";
const LOWER = "▄";
const BLANK = " ";

/**
 * Least ink to most, for the terminal that has no colour to give.
 *
 * Ink is LIGHT on the dark background a TUI usually sits on, so the dense glyph
 * is the bright pixel. The ramp this replaces ran the other way and rendered the
 * stone's lit top face as its darkest region.
 */
const GLYPHS = ["░", "▒", "▓", "█"] as const;

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const DEFAULT_BG = `${ESC}[49m`;

export const lumOf = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * A palette and one index character per pixel, two rows to a cell. `.` is
 * transparent. Written this way so `banner.ts` reads as the pixel art it is.
 */
export function decodeMark(palette: readonly string[], rows: readonly string[]): Mark {
  if (rows.length % 2 !== 0) {
    throw new Error(`a mark is pixel rows in pairs, one cell each; got ${String(rows.length)}`);
  }
  const colors = palette.map(parseHex);

  const pixel = (row: string, x: number): Rgb | null => {
    const ch = row[x] ?? ".";
    if (ch === ".") return null;
    const at = DIGITS.indexOf(ch);
    const color = at < 0 ? undefined : colors[at];
    if (color === undefined) throw new Error(`"${ch}" is not an index into a palette of ${String(colors.length)}`);
    return color;
  };

  const cells: Cell[][] = [];
  for (let r = 0; r < rows.length; r += 2) {
    const top = rows[r]!, bottom = rows[r + 1]!;
    const width = Math.max(top.length, bottom.length);
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) row.push({ top: pixel(top, x), bottom: pixel(bottom, x) });
    cells.push(row);
  }
  return cells;
}

/** Index characters, in palette order. Matches `scripts/sprite-to-ascii.ts`. */
const DIGITS = "0123456789abcdefghijklmnopqrstuv";

function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`a palette entry is #rrggbb; got "${hex}"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** xterm's 6x6x6 cube, and the 24 greys beside it. */
const CUBE = [0, 95, 135, 175, 215, 255];

function ansi256(c: Rgb): number {
  const step = (v: number): number => {
    let best = 0;
    for (let i = 1; i < CUBE.length; i++) {
      if (Math.abs(v - CUBE[i]!) < Math.abs(v - CUBE[best]!)) best = i;
    }
    return best;
  };
  const rgbIdx = [step(c[0]), step(c[1]), step(c[2])] as const;
  const cube: Rgb = [CUBE[rgbIdx[0]]!, CUBE[rgbIdx[1]]!, CUBE[rgbIdx[2]]!];

  // The stone is almost entirely neutral, and the grey ramp resolves neutrals
  // four times as finely as the cube does. Picking by distance rather than by
  // rule is what lets the one coloured pixel still land in the cube.
  const g = Math.min(23, Math.max(0, Math.round((lumOf(c) - 8) / 10)));
  const grey = 8 + g * 10;
  const greyRgb: Rgb = [grey, grey, grey];

  return dist2(c, greyRgb) <= dist2(c, cube)
    ? 232 + g
    : 16 + 36 * rgbIdx[0] + 6 * rgbIdx[1] + rgbIdx[2];
}

const dist2 = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const fgOf = (c: Rgb, depth: ColorDepth): string =>
  depth === "truecolor"
    ? `${ESC}[38;2;${String(c[0])};${String(c[1])};${String(c[2])}m`
    : `${ESC}[38;5;${String(ansi256(c))}m`;

const bgOf = (c: Rgb, depth: ColorDepth): string =>
  depth === "truecolor"
    ? `${ESC}[48;2;${String(c[0])};${String(c[1])};${String(c[2])}m`
    : `${ESC}[48;5;${String(ansi256(c))}m`;

const BLANK_CELL: Cell = { top: null, bottom: null };

/**
 * Two marks side by side, one drawing, so a single render pass colours both. A
 * row the right block does not reach is left short: a trailing cell would paint
 * background out to the width of the pair.
 */
export function beside(left: Mark, right: Mark, gap: number): Mark {
  const width = Math.max(...left.map((row) => row.length));

  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const l = left[i] ?? [];
    const r = right[i] ?? [];
    if (r.length === 0) return [...l];
    return [...l, ...Array<Cell>(width - l.length + gap).fill(BLANK_CELL), ...r];
  });
}

export function renderMark(mark: Mark, depth: ColorDepth): string[] {
  return depth === "none" ? renderMono(mark) : mark.map((row) => renderRow(row, depth));
}

/**
 * The four transparency cases. A half block paints a background as well as a
 * foreground, so a cell silent about its background inherits the previous one's
 * and stamps it into the gap around the mark.
 */
function renderRow(row: readonly Cell[], depth: ColorDepth): string {
  // Unknown, not default: the first cell of every line states its background
  // rather than trusting what the line above left behind.
  let fg: string | null = null;
  let bg: string | null = null;
  let out = "";

  const want = (nextFg: string | null, nextBg: string, glyph: string): void => {
    if (nextFg !== null && nextFg !== fg) { out += nextFg; fg = nextFg; }
    if (nextBg !== bg) { out += nextBg; bg = nextBg; }
    out += glyph;
  };

  for (const cell of row) {
    if (cell.top !== null && cell.bottom !== null) {
      want(fgOf(cell.top, depth), bgOf(cell.bottom, depth), UPPER);
    } else if (cell.top !== null) {
      want(fgOf(cell.top, depth), DEFAULT_BG, UPPER);
    } else if (cell.bottom !== null) {
      want(fgOf(cell.bottom, depth), DEFAULT_BG, LOWER);
    } else {
      want(null, DEFAULT_BG, BLANK);
    }
  }
  return `${out}${RESET}`;
}

/**
 * No colour to give, so brightness goes back into the glyph. The silhouette is
 * kept at full resolution: a half-covered cell stays a half block, and only a
 * cell with both pixels is shaded.
 */
function renderMono(mark: Mark): string[] {
  const lums = mark.flatMap((row) =>
    row.flatMap((c) => [c.top, c.bottom].filter((p) => p !== null).map(lumOf)),
  );
  const min = Math.min(...lums), max = Math.max(...lums);
  const span = max - min;

  const shade = (a: Rgb, b: Rgb): string => {
    const v = (lumOf(a) + lumOf(b)) / 2;
    // Equal RANGES, not equal counts: a face drawn in one flat tone belongs in
    // one bucket, and quartiles would speckle it across all four.
    const at = span === 0 ? 0 : Math.min(3, Math.floor(((v - min) / span) * 4));
    return GLYPHS[at]!;
  };

  return mark.map((row) =>
    row
      .map((c) =>
        c.top !== null && c.bottom !== null
          ? shade(c.top, c.bottom)
          : c.top !== null
            ? UPPER
            : c.bottom !== null
              ? LOWER
              : BLANK,
      )
      .join(""),
  );
}
