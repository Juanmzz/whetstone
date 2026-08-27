/**
 * The stone being honed, as frames. PURE.
 *
 * Two strokes across the working face and it settles. Not decoration: it is
 * the thing the tool is named for, and it is the only animation here because
 * any other would be something you wait for on every open.
 *
 * The shell must let any keypress jump to the last frame.
 */

/** The lighter shade a stroke leaves on the top face. */
const STROKE = "▒";
const FACE = "░";

/** Which rows carry the top face, which is the only surface a stroke touches. */
function topRows(mark: readonly string[]): number[] {
  return mark.flatMap((row, i) => (row.includes(FACE) ? [i] : []));
}

/** One diagonal pass at `offset`, drawn only over the face. */
function stroke(mark: readonly string[], rows: readonly number[], offset: number): string[] {
  return mark.map((row, i) => {
    const place = rows.indexOf(i);
    if (place < 0) return row;
    const at = offset + place * 2;
    if (at < 0 || at >= row.length) return row;
    if (row[at] !== FACE) return row;
    return row.slice(0, at) + STROKE + row.slice(at + 1);
  });
}

export function honingFrames(mark: readonly string[]): string[][] {
  const rows = topRows(mark);
  if (rows.length === 0) return [[...mark]];

  const width = Math.max(...mark.map((r) => r.length));
  const frames: string[][] = [];

  // A shudder first: the stone jumping under the blade. One column, and by
  // indenting rather than editing rows, so nothing can wrap differently.
  for (const nudge of [1, 0, 1]) {
    frames.push(mark.map((row) => " ".repeat(nudge) + row));
  }

  // Two passes, each sweeping the stroke across the face. Odd offsets so the
  // second lands between the first one's marks rather than over them.
  for (const start of [2, 5]) {
    for (let step = 0; step < 3; step++) {
      frames.push(stroke(mark, rows, start + step * Math.floor(width / 5)));
    }
  }

  frames.push([...mark]);
  return frames;
}
