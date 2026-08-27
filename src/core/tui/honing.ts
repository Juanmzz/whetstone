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

/** The lighter shade a stroke leaves on the top face. */
const STROKE = "▒";
const FACE = "░";

/** Columns per row: the two angles the drawn mark actually has. */
const ALONG = -6;
const ACROSS = 3;

interface Row {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** The top face, row by row. The only surface a stroke touches. */
function faceRows(mark: readonly string[]): Row[] {
  return mark.flatMap((row, at) => {
    const from = row.indexOf(FACE);
    return from < 0 ? [] : [{ at, from, to: row.lastIndexOf(FACE) }];
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

function stroke(
  mark: readonly string[],
  rows: readonly Row[],
  offset: number,
  step: number,
): string[] {
  const out = [...mark];
  rows.forEach((r, k) => {
    const at = offset + k * step;
    const row = out[r.at]!;
    if (at < 0 || at >= row.length || row[at] !== FACE) return;
    out[r.at] = row.slice(0, at) + STROKE + row.slice(at + 1);
  });
  return out;
}

export function honingFrames(mark: readonly string[]): string[][] {
  const rows = faceRows(mark);
  if (rows.length === 0) return [[...mark]];

  const frames: string[][] = [];

  // A shudder first: the stone jumping under the blade. One column, and by
  // indenting rather than editing rows, so nothing can wrap differently.
  for (const nudge of [1, 0, 1]) frames.push(mark.map((row) => " ".repeat(nudge) + row));

  const along = bestOffset(rows, ALONG);
  for (const lead of [0, -3]) {
    for (let k = 0; k < 3; k++) frames.push(stroke(mark, rows, along + lead - k * 3, ALONG));
  }

  const across = bestOffset(rows, ACROSS);
  for (let k = 0; k < 3; k++) frames.push(stroke(mark, rows, across - 3 + k * 3, ACROSS));

  frames.push([...mark]);
  return frames;
}
