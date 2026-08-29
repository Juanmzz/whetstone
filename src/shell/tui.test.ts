import { describe, expect, it } from "vitest";
import { paint } from "./tui.js";

const ESC = String.fromCharCode(27);

/** Just enough of a stream to capture what was written. */
function fake(): { out: NodeJS.WriteStream; written: () => string } {
  let buf = "";
  return {
    out: { write: (s: string) => void (buf += s) } as unknown as NodeJS.WriteStream,
    written: () => buf,
  };
}

describe("paint", () => {
  it("stops on its last line rather than one past it", () => {
    // A full-height screen was scrolling by one and losing its top row.
    const { out, written } = fake();

    paint(out, ["a", "b", "c"]);

    expect(written().endsWith("c")).toBe(true);
  });

  it("still separates the lines it was given", () => {
    const { out, written } = fake();

    paint(out, ["a", "b"]);

    expect(written()).toContain(`a${String.fromCharCode(10)}b`);
  });

  it("clears and hides the cursor before drawing", () => {
    const { out, written } = fake();

    paint(out, ["a"]);

    expect(written().startsWith(`${ESC}[2J${ESC}[H${ESC}[?25l`)).toBe(true);
  });
});
