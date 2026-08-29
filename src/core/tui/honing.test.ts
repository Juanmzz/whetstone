import { describe, expect, it } from "vitest";
import { honingFrames } from "./honing.js";
import { decodeMark, lumOf, type Cell, type Mark } from "./mark.js";

/** Dark, mid, light. Only the lightest tone is the working face. */
const PALETTE = ["#202020", "#808080", "#e8e8e8"];

/** Three rows of face over one of base. Twenty wide, because a pass runs six
 * columns per row and a narrower fixture cannot hold one segment. */
const MARK = decodeMark(PALETTE, [
  "..222222222222222222",
  "..222222222222222222",
  "..222222222222222222",
  "..222222222222222222",
  "..222222222222222222",
  "..222222222222222222",
  "..111111110000000000",
  "..111111110000000000",
]);

/** The row of base: the surface a stroke must never touch. */
const BASE = 3;

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

  /** The first row a frame lightened, and which columns of it. */
  const struckRow = (frame: Mark): { at: number; xs: number[] } =>
    MARK.map((_, at) => ({ at, xs: struck(frame, at) })).find((r) => r.xs.length > 0)!;

  it("lightens the cell it strokes rather than replacing it", () => {
    // The stroke used to be a lighter GLYPH, which is the only thing a four-tone
    // ramp could offer. With the pixel's own colour it is that colour, lifted.
    const cut = frames.find(cuts);

    expect(cut).toBeDefined();
    const { at, xs } = struckRow(cut!);
    expect(cut![at]![xs[0]!]!.top).not.toBeNull();
  });

  it("cuts across the working face and nowhere else", () => {
    // The stroke belongs on the top face. A slash through the dark side is a
    // scratch on the part of the stone nothing touches.
    const cut = frames.find(cuts);

    expect(struck(cut!, BASE)).toEqual([]);
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

  it("draws a continuous segment across a row, not one cell every sixth column", () => {
    // One cell per row is six specks in a diagonal: dust, not a blade.
    const cut = frames.find(cuts)!;

    const columns = MARK.map((_, at) => struck(cut, at)).find((c) => c.length > 1)!;

    expect(columns).toEqual(
      Array.from({ length: columns.length }, (_, i) => columns[0]! + i),
    );
  });

  it("splits the segment between the two halves of the row it crosses", () => {
    // Columns on the near side of the crossing get their UPPER pixel and the
    // rest their lower one, which is what lets the segment be continuous.
    const cut = frames.find(cuts)!;

    const rows = MARK.map((_, at) => ({ at, xs: struck(cut, at) })).filter((r) => r.xs.length > 1);
    const halves = rows.flatMap(({ at, xs }) =>
      xs.map((x) => (cut[at]![x]!.top !== MARK[at]![x]!.top ? "top" : "bottom")),
    );

    expect(new Set(halves)).toEqual(new Set(["top", "bottom"]));
  });
});

describe("honingFrames on a face the shape of the entrance", () => {
  // Only a face shaped like the real one can show a pass walking off it: a full
  // rectangle has no edge to leave. These are the measured spans of the
  // 56-column mark, row by row.
  const SPANS = [
    [37, 38], [32, 42], [25, 47], [19, 51], [12, 52],
    [6, 46], [3, 40], [6, 34], [12, 27], [16, 22],
  ] as const;

  const lens = decodeMark(
    PALETTE,
    SPANS.flatMap(([from, to]) => {
      const row = Array.from({ length: 56 }, (_, x) => (x >= from && x <= to ? "2" : "1")).join("");
      return [row, row];
    }),
  );

  const frames = honingFrames(lens);
  const cutsOn = (frame: Mark): boolean =>
    lens.some((row, at) => {
      const after = frame[at] ?? [];
      const shift = after.length - row.length;
      return row.some((cell, x) => {
        const now = after[x + shift];
        return now !== undefined && bright(now) > bright(cell);
      });
    });

  it("never plays a frame that cuts nothing, which reads as a stall", () => {
    const shudders = frames.filter((f) => (f[0]?.length ?? 0) > lens[0]!.length).length;
    const cutting = frames.filter(cutsOn).length;

    // Every frame but the two that hold the mark itself: the still one inside
    // the shudder, and the last.
    expect(cutting + shudders).toBe(frames.length - 2);
  });
});
