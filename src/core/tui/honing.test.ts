import { describe, expect, it } from "vitest";
import { honingFrames } from "./honing.js";

const MARK = [
  "  ░░░░░░░░",
  "  ░░░░░░░░",
  "  ▓▓▓▓████",
];

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

  it("cuts across the working face and nowhere else", () => {
    // The stroke belongs on the top face. A slash through the dark side is a
    // scratch on the part of the stone nothing touches.
    const cut = frames.find((f) => f.join("").includes("▒"));

    expect(cut).toBeDefined();
    expect(cut?.[2]).toBe(MARK[2]);
  });

  it("shudders before the first stroke, and only before it", () => {
    // The stone jumps under the blade. Done by indenting the whole block, so no
    // row's content changes and nothing can wrap differently.
    const shifted = frames.filter((f) => f.some((row) => row.startsWith("   ░")));

    expect(shifted.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.some((row) => row.startsWith("   ░"))).toBe(false);
  });

  it("never changes the width of a row, so the layout cannot jump", () => {
    for (const frame of frames) {
      frame.forEach((row, i) => expect(row.trimEnd().length).toBeLessThanOrEqual(MARK[i]!.length + 1));
    }
  });

  it("keeps the same number of rows throughout", () => {
    for (const frame of frames) expect(frame).toHaveLength(MARK.length);
  });

  it("returns the mark alone when there is no face to cut", () => {
    expect(honingFrames([])).toEqual([[]]);
  });

  it("passes more than once, because one stroke does not hone anything", () => {
    const cutting = frames.filter((f) => f.join("").includes("▒"));

    expect(cutting.length).toBeGreaterThanOrEqual(2);
  });
});
