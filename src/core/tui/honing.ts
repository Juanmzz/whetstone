/**
 * The stone being honed, as frames. PURE.
 *
 * A shudder, two strokes along its length, then one back across the narrow
 * way, because honing alternates direction rather than repeating one. It is
 * the only animation here: any other would be something you wait for on every
 * open.
 *
 * The shell must let any keypress jump to the last frame.
 */

import { lumOf, type Cell, type Mark, type Rgb } from "./mark.js";

/** How far up the mark's own luminance range the working face begins. */
const FACE_FROM = 0.75;

/** How far a stroke lifts the pixel it passes over. The face is already light,
 * so a third of the way to white is a change you have to look for. */
const LIFT = 0.55;

/** Columns per row: the two angles the drawn mark actually has. */
const ALONG = -6;
const ACROSS = 3;

const BLANK: Cell = { top: null, bottom: null };

interface Row {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** One face pixel a pass passes over. */
interface Touch {
  readonly at: number;
  readonly x: number;
  readonly half: "top" | "bottom";
}

/**
 * Where the working face starts, in this drawing's own terms. Strictly above, so
 * a mark drawn in one flat tone has no face rather than being face all over.
 */
function faceAbove(mark: Mark): number {
  const lums = mark.flatMap((row) =>
    row.flatMap((c) => [c.top, c.bottom].filter((p) => p !== null).map(lumOf)),
  );
  if (lums.length === 0) return Infinity;
  const min = Math.min(...lums), max = Math.max(...lums);
  return min + FACE_FROM * (max - min);
}

const isFace = (p: Rgb | null, above: number): boolean => p !== null && lumOf(p) > above;
const facing = (cell: Cell, above: number): boolean =>
  isFace(cell.top, above) || isFace(cell.bottom, above);

/** The top face, row by row. The only surface a stroke touches. */
function faceRows(mark: Mark, above: number): Row[] {
  return mark.flatMap((row, at) => {
    const from = row.findIndex((c) => facing(c, above));
    if (from < 0) return [];
    let to = from;
    row.forEach((c, x) => { if (facing(c, above)) to = x; });
    return [{ at, from, to }];
  });
}

/**
 * Every face pixel one pass passes over. The ONE traversal, read by both the walk
 * and the stroke. Drawn twice per row so the seam falls where the line crosses;
 * otherwise a pass running six columns per row lifts one cell in six.
 */
function touched(
  mark: Mark,
  rows: readonly Row[],
  offset: number,
  step: number,
  above: number,
): Touch[] {
  const out: Touch[] = [];

  rows.forEach((r, k) => {
    const start = offset + k * step;
    const end = start + step;
    const mid = (start + end) / 2;
    const row = mark[r.at] ?? [];

    const half = (a: number, b: number, which: "top" | "bottom"): void => {
      // Face pixels only: a cell straddling the top edge holds one of each.
      for (let x = Math.ceil(Math.min(a, b)); x < Math.max(a, b); x++) {
        const cell = row[x];
        if (cell !== undefined && isFace(cell[which], above)) out.push({ at: r.at, x, half: which });
      }
    };

    half(start, mid, "top");
    half(mid, end, "bottom");
  });

  return out;
}

/**
 * The offsets one pass walks through, derived at BOTH ends against `touched`: in
 * only if it still lifts half of what the best one does. Tuned offsets walk off
 * a redrawn sprite in silence.
 */
function walk(
  mark: Mark,
  rows: readonly Row[],
  step: number,
  count: number,
  above: number,
): number[] {
  const reach = Math.abs(step) * rows.length + Math.max(...rows.map((r) => r.to)) + 1;

  const scored: { offset: number; n: number }[] = [];
  for (let offset = -reach; offset <= reach; offset++) {
    scored.push({ offset, n: touched(mark, rows, offset, step, above).length });
  }
  const best = Math.max(...scored.map((s) => s.n));
  if (best === 0) return [];

  const live = scored.filter((s) => s.n * 2 >= best).map((s) => s.offset);
  const hi = Math.max(...live), lo = Math.min(...live);
  return Array.from({ length: count }, (_, i) =>
    Math.round(hi - (i / (count - 1)) * (hi - lo)),
  );
}

/** Towards white, keeping the pixel's own hue. */
const lift = (p: Rgb): Rgb => [
  Math.round(p[0] + (255 - p[0]) * LIFT),
  Math.round(p[1] + (255 - p[1]) * LIFT),
  Math.round(p[2] + (255 - p[2]) * LIFT),
];

function stroke(mark: Mark, touches: readonly Touch[]): Mark {
  const out: Cell[][] = mark.map((row) => [...row]);
  for (const t of touches) {
    const cell = out[t.at]?.[t.x];
    if (cell === undefined) continue;
    out[t.at]![t.x] = { ...cell, [t.half]: lift(cell[t.half]!) };
  }
  return out;
}

export function honingFrames(mark: Mark): Mark[] {
  const above = faceAbove(mark);
  const rows = faceRows(mark, above);
  if (rows.length === 0) return [mark];

  const frames: Mark[] = [];

  // A shudder first: the stone jumping under the blade. One column, and by
  // prepending a blank cell rather than editing rows, so nothing can wrap
  // differently.
  for (const nudge of [1, 0, 1]) {
    frames.push(nudge === 0 ? mark : mark.map((row) => [BLANK, ...row]));
  }

  const pass = (step: number): void => {
    for (const offset of walk(mark, rows, step, 3, above)) {
      frames.push(stroke(mark, touched(mark, rows, offset, step, above)));
    }
  };

  // Twice along, then once across. The direction changing at the end is what
  // makes it honing rather than sanding.
  pass(ALONG);
  pass(ALONG);
  pass(ACROSS);

  frames.push(mark);
  return frames;
}
