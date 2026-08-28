import { describe, expect, it } from "vitest";
import { wrap, wrapped } from "./text.js";

describe("wrap", () => {
  it("keeps every line inside the width", () => {
    for (const line of wrap("one two three four five six seven eight", 12)) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it("loses no word, which is the whole difference from cutting", () => {
    const text = "adr-refs, comment-density, correctness, docs-fresh, in-force";
    expect(wrap(text, 20).join(" ")).toBe(text);
  });

  it("gives a word longer than the width its own line rather than breaking it", () => {
    // A path or a check id cut in half resolves to nothing and looks like a typo.
    expect(wrap("a supercalifragilistic b", 8)).toEqual(["a", "supercalifragilistic", "b"]);
  });

  it("answers with nothing for nothing", () => {
    expect(wrap("", 40)).toEqual([]);
    expect(wrap("   ", 40)).toEqual([]);
  });

  it("collapses the newlines and runs of space a source string carries", () => {
    expect(wrap("one\n\ntwo   three", 40)).toEqual(["one two three"]);
  });
});

describe("wrapped", () => {
  it("counts the indent against the width, not on top of it", () => {
    for (const line of wrapped("one two three four five", 12, "    ")) {
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it("indents every line, including the first", () => {
    for (const line of wrapped("one two three", 40, "  ")) expect(line.startsWith("  ")).toBe(true);
  });
});
