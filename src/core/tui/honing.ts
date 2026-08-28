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

/**
 * How far a stroke lifts the pixel it passes over, towards white.
 *
 * Chosen against the drawing rather than by taste: the face is already light, so
 * a third of the way to white is a change you have to look for. The glyph swap
 * this replaces was a whole step down a four-tone ramp, and the stroke should
 * stay about as loud as it was.
 */
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

/**
 * Where the working face starts, in this drawing's own terms.
 *
 * Derived and not a constant, for the reason `bestOffset` is: the face used to
 * be "the cells drawn with `░`", which a redrawn sprite could rename without
 * anything noticing. Strictly above, so a mark drawn in one flat tone has no
 * face at all rather than being face all over.
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
 * Where to start so the stroke stays on the face for as many rows as it can.
 *
 * Derived, not hardcoded. The first version used offsets tuned to one drawing,
 * so a redrawn sprite would have walked the strokes off it in silence.
 */
function bestOffset(rows: readonly Row[], step: number): number {
  const widest = Math.max(...rows.map((r) => r.to)) + 1;
  let best = { offset: 0, hits: -1 };
  for (let offset = -widest; offset <= widest * 2; offset++) {
    let hits = 0;
    rows.forEach((r, k) => {
      const at = offset + k * step;
      if (at >= r.from && at <= r.to) hits += 1;
    });
    if (hits > best.hits) best = { offset, hits };
  }
  return best.offset;
}

/** Towards white, keeping the pixel's own hue. */
const lift = (p: Rgb): Rgb => [
  Math.round(p[0] + (255 - p[0]) * LIFT),
  Math.round(p[1] + (255 - p[1]) * LIFT),
  Math.round(p[2] + (255 - p[2]) * LIFT),
];

function stroke(mark: Mark, rows: readonly Row[], offset: number, step: number, above: number): Mark {
  const out: (readonly Cell[])[] = [...mark];
  rows.forEach((r, k) => {
    const at = offset + k * step;
    const row = out[r.at]!;
    const cell = row[at];
    if (at < 0 || cell === undefined || !facing(cell, above)) return;

    // Only the pixels that ARE the face. A cell straddling the top edge holds
    // one of each, and lifting the dark one would smear the stroke off the face.
    const cut: Cell = {
      top: isFace(cell.top, above) ? lift(cell.top!) : cell.top,
      bottom: isFace(cell.bottom, above) ? lift(cell.bottom!) : cell.bottom,
    };
    out[r.at] = [...row.slice(0, at), cut, ...row.slice(at + 1)];
  });
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

  const along = bestOffset(rows, ALONG);
  for (const lead of [0, -3]) {
    for (let k = 0; k < 3; k++) frames.push(stroke(mark, rows, along + lead - k * 3, ALONG, above));
  }

  const across = bestOffset(rows, ACROSS);
  for (let k = 0; k < 3; k++) frames.push(stroke(mark, rows, across - 3 + k * 3, ACROSS, above));

  frames.push(mark);
  return frames;
}
