import { describe, expect, it } from "vitest";
import { beside, decodeMark, renderMark, type Mark } from "./mark.js";

const PALETTE = ["#000000", "#ff0000", "#00ff00"];

/** Two cells wide, one cell tall: enough for every transparency case. */
const mark = (...rows: string[]): Mark => decodeMark(PALETTE, rows);

const ESC = String.fromCharCode(27);

describe("decodeMark", () => {
  it("reads a palette index per pixel and pairs two rows into one cell", () => {
    const decoded = decodeMark(PALETTE, ["01", "20"]);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toEqual([
      { top: [0, 0, 0], bottom: [0, 255, 0] },
      { top: [255, 0, 0], bottom: [0, 0, 0] },
    ]);
  });

  it("reads `.` as the transparent pixel it stands for", () => {
    const decoded = decodeMark(PALETTE, [".1", "2."]);

    expect(decoded[0]).toEqual([
      { top: null, bottom: [0, 255, 0] },
      { top: [255, 0, 0], bottom: null },
    ]);
  });

  it("refuses an odd number of pixel rows rather than dropping the last one", () => {
    expect(() => decodeMark(PALETTE, ["0"])).toThrow(/pairs/i);
  });

  it("refuses an index the palette does not have", () => {
    expect(() => decodeMark(PALETTE, ["9", "0"])).toThrow(/palette/i);
  });
});

describe("renderMark, truecolor", () => {
  it("draws an upper half block with the top pixel in front and the bottom behind", () => {
    const [line] = renderMark(mark("1", "2"), "truecolor");

    expect(line).toContain("▀");
    expect(line).toContain(`${ESC}[38;2;255;0;0m`);
    expect(line).toContain(`${ESC}[48;2;0;255;0m`);
  });

  it("keeps the terminal's own background where the lower pixel is transparent", () => {
    // Without the reset the previous cell's colour fills the gap around the mark.
    const [line] = renderMark(mark("1", "."), "truecolor");

    expect(line).toContain("▀");
    expect(line).toContain(`${ESC}[49m`);
    expect(line).not.toContain("48;2;");
  });

  it("flips to a lower half block where the upper pixel is transparent", () => {
    // `▄` with a foreground only leaves the top half showing the terminal.
    const line = renderMark(mark(".", "2"), "truecolor")[0]!;

    expect(line).toContain("▄");
    expect(line).toContain(`${ESC}[38;2;0;255;0m`);
    expect(line).not.toContain("48;2;");
  });

  it("draws a blank where both pixels are transparent", () => {
    const line = renderMark(mark(".", "."), "truecolor")[0]!;

    expect(line.replace(/\x1b\[[0-9;]*m/g, "")).toBe(" ");
  });

  it("resets the background before a blank that follows a painted cell", () => {
    // A background left set runs to the end of the row as a coloured bar.
    const line = renderMark(mark("1.", "2."), "truecolor")[0]!;

    const blank = line.slice(line.indexOf("▀") + 1);
    expect(blank).toContain(`${ESC}[49m`);
  });

  it("closes every line, so no row can colour the one below it", () => {
    const lines = renderMark(mark("11", "22"), "truecolor");

    for (const line of lines) expect(line.endsWith(`${ESC}[0m`)).toBe(true);
  });
});

describe("renderMark, 256 colours", () => {
  it("indexes the xterm cube instead of naming the channels", () => {
    const [line] = renderMark(mark("1", "2"), "ansi256");

    expect(line).toMatch(/\x1b\[38;5;\d+m/);
    expect(line).not.toContain("38;2;");
  });

  it("still keeps the terminal background under a transparent lower pixel", () => {
    const [line] = renderMark(mark("1", "."), "ansi256");

    expect(line).toContain(`${ESC}[49m`);
    expect(line).not.toContain("48;5;");
  });

  it("sends a grey to the grey ramp rather than the nearest cube corner", () => {
    // The stone is neutral, and the grey ramp resolves neutrals four times as
    // finely as the cube.
    const [line] = renderMark(decodeMark(["#808080"], ["0", "0"]), "ansi256");

    const code = /38;5;(\d+)m/.exec(line ?? "")?.[1];
    expect(Number(code)).toBeGreaterThanOrEqual(232);
  });
});

describe("renderMark, no colour", () => {
  it("emits no escape sequence at all", () => {
    const lines = renderMark(mark("11", "22"), "none");

    for (const line of lines) expect(line).not.toContain(ESC);
  });

  it("shades a full cell from the luminance ramp, densest where it is brightest", () => {
    // Ink is light on a dark terminal, so the solid block is the LIT pixel. The
    // ramp that ran the other way drew the stone's top face as its darkest part.
    const lines = renderMark(decodeMark(["#000000", "#ffffff"], ["01", "01"]), "none");

    expect(lines[0]).toBe("░█");
  });

  it("keeps a half-covered cell a half block, so the silhouette survives", () => {
    const lines = renderMark(mark("1.", ".2"), "none");

    expect(lines[0]).toBe("▀▄");
  });
});

describe("beside", () => {
  const blank = { top: null, bottom: null };

  it("sets the second mark to the right of the first, a gap of blanks between", () => {
    const composed = beside(mark("1", "2"), mark("1", "2"), 2);

    expect(composed).toHaveLength(1);
    expect(composed[0]).toHaveLength(4);
    expect(composed[0]?.[1]).toEqual(blank);
    expect(composed[0]?.[3]).toEqual({ top: [255, 0, 0], bottom: [0, 255, 0] });
  });

  it("leaves a row as it was where the right mark has run out", () => {
    // The word is shorter than the stone, and a row padded to the full width
    // would paint the terminal background out to column eighty.
    const composed = beside(mark("11", "22", "11", "22"), mark("1", "2"), 1);

    expect(composed[0]).toHaveLength(4);
    expect(composed[1]).toHaveLength(2);
  });

  it("squares a ragged left mark, so the right one starts in one column", () => {
    const left = decodeMark(PALETTE, ["11", "22", "1", "2"]);
    const composed = beside(left, mark("1", "2", "1", "2"), 1);

    expect(composed[1]).toHaveLength(4);
    expect(composed[1]?.[1]).toEqual(blank);
  });
});
