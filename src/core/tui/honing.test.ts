import { describe, expect, it } from "vitest";
import { honingFrames } from "./honing.js";
import { decodeMark, lumOf, type Cell, type Mark } from "./mark.js";

/** Dark, mid, light. Only the lightest tone is the working face. */
const PALETTE = ["#202020", "#808080", "#e8e8e8"];

/** Two rows of top face over one row of base, the shape a stroke has to respect. */
const MARK = decodeMark(PALETTE, [
  "..22222222",
  "..22222222",
  "..22222222",
  "..22222222",
  "..11110000",
  "..11110000",
]);

const bright = (cell: Cell): number =>
  (cell.top === null ? 0 : lumOf(cell.top)) + (cell.bottom === null ? 0 : lumOf(cell.bottom));

/** The columns a frame lightened, row by row. */
const struck = (frame: Mark, at: number): number[] => {
  const before = MARK[at] ?? [];
  const after = frame[at] ?? [];
  const shift = after.length - before.length;
  return before.flatMap((cell, x) => {
    const now = after[x + shift];
    return now !== undefined && bright(now) > bright(cell) ? [x] : [];
  });
};

const cuts = (frame: Mark): boolean => MARK.some((_, at) => struck(frame, at).length > 0);

describe("honingFrames", () => {
  const frames = honingFrames(MARK);

  it("ends on the mark itself, untouched", () => {
    // Whatever happens in between, what stays on screen is the logo.
    expect(frames.at(-1)).toEqual(MARK);
  });

  it("is short enough that nobody waits for it", () => {
    // At ~40ms a frame, sixteen is under two thirds of a second. Past that it
    // stops being an entrance and starts being a delay.
    expect(frames.length).toBeLessThanOrEqual(16);
    expect(frames.length).toBeGreaterThan(3);
  });

  it("lightens the cell it strokes rather than replacing it", () => {
    // The stroke used to be a lighter GLYPH, which is the only thing a four-tone
    // ramp could offer. With the pixel's own colour it is that colour, lifted.
    const cut = frames.find(cuts);

    expect(cut).toBeDefined();
    const [x] = struck(cut!, 0);
    expect(x).toBeDefined();
    expect(cut![0]![x!]!.top).not.toBeNull();
  });

  it("cuts across the working face and nowhere else", () => {
    // The stroke belongs on the top face. A slash through the dark side is a
    // scratch on the part of the stone nothing touches.
    const cut = frames.find(cuts);

    expect(struck(cut!, 2)).toEqual([]);
  });

  it("shudders before the first stroke, and only before it", () => {
    // The stone jumps under the blade. Done by prepending a blank cell, so no
    // row's content changes and nothing can wrap differently.
    const wider = frames.filter((f) => (f[0]?.length ?? 0) > MARK[0]!.length);

    expect(wider.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.[0]?.length).toBe(MARK[0]!.length);
  });

  it("never changes the width of a row, so the layout cannot jump", () => {
    for (const frame of frames) {
      frame.forEach((row, i) => expect(row.length).toBeLessThanOrEqual(MARK[i]!.length + 1));
    }
  });

  it("keeps the same number of rows throughout", () => {
    for (const frame of frames) expect(frame).toHaveLength(MARK.length);
  });

  it("returns the mark alone when there is no face to cut", () => {
    expect(honingFrames([])).toEqual([[]]);
  });

  it("leaves a mark with no face alone rather than striking its dark side", () => {
    // The guard in the other direction: a drawing whose lightest tone is still
    // dark has no working face, and inventing one would scratch the whole stone.
    const dark = decodeMark(["#202020"], ["0000", "0000"]);

    expect(honingFrames(dark)).toEqual([dark]);
  });

  it("crosses the other way at the end, because honing alternates direction", () => {
    // Two along the long axis, then one across the narrow one. Repeating a
    // single direction is not what sharpening looks like.
    const cutting = frames.filter(cuts);
    const lean = (frame: Mark): number => {
      const marks = MARK.flatMap((_, at) => struck(frame, at).slice(0, 1));
      return marks.length < 2 ? 0 : Math.sign(marks.at(-1)! - marks[0]!);
    };

    expect(lean(cutting[0]!)).not.toBe(0);
    expect(lean(cutting.at(-1)!)).toBe(-lean(cutting[0]!));
  });

  it("passes more than once, because one stroke does not hone anything", () => {
    expect(frames.filter(cuts).length).toBeGreaterThanOrEqual(2);
  });
});
