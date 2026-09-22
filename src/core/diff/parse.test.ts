import { describe, expect, it } from "vitest";
import { parseNameStatus, parseNameStatusZ } from "./parse.js";

describe("parseNameStatus", () => {
  it("returns nothing for an empty diff", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus("\n")).toEqual([]);
  });

  it("reads the common statuses", () => {
    const raw = ["M\tsrc/core/gate.ts", "A\tsrc/core/new.ts", "D\told.ts"].join("\n");
    expect(parseNameStatus(raw)).toEqual([
      { path: "src/core/gate.ts", status: "modified" },
      { path: "src/core/new.ts", status: "added" },
      { path: "old.ts", status: "deleted" },
    ]);
  });

  it("reads a rename as the NEW path, keeping the old one", () => {
    // Triage classifies what the change becomes, so `path` must be the new path.
    expect(parseNameStatus("R100\tGUIDE.md\tdocs/PARALLEL.md")).toEqual([
      { path: "docs/PARALLEL.md", status: "renamed", oldPath: "GUIDE.md" },
    ]);
  });

  it("reads a copy the same way", () => {
    expect(parseNameStatus("C75\ta.ts\tb.ts")).toEqual([
      { path: "b.ts", status: "copied", oldPath: "a.ts" },
    ]);
  });

  it("tolerates a trailing newline and blank lines", () => {
    expect(parseNameStatus("M\ta.ts\n\nM\tb.ts\n")).toHaveLength(2);
  });

  it("keeps paths containing spaces intact", () => {
    expect(parseNameStatus("M\tdocs/my notes.md")).toEqual([
      { path: "docs/my notes.md", status: "modified" },
    ]);
  });

  // A gate that silently mis-parses is worse than one that fails loudly:
  // an unparsed file is an UNGATED file.
  it("throws on an unknown status rather than guessing", () => {
    expect(() => parseNameStatus("X\tweird.ts")).toThrow(/unknown git status/i);
  });

  it("throws when a rename is missing its second path", () => {
    expect(() => parseNameStatus("R100\tonly-one.ts")).toThrow(/rename/i);
  });

  it("throws on a line with no tab", () => {
    expect(() => parseNameStatus("garbage")).toThrow(/unparseable/i);
  });
});

/**
 * Reproduced 2026-09-21: a staged `special/a<TAB>b.js` arrived quoted, the blocking
 * check covering `special/**` matched nothing and was absent from the report, and
 * `ready` said `Ready`, exit 0.
 */
describe("parseNameStatusZ — the NUL-delimited format, where a path is bytes", () => {
  const z = (...tokens: string[]): string => `${tokens.join("\0")}\0`;

  it("reads a path containing a tab, which the line format cannot", () => {
    expect(parseNameStatusZ(z("M", "special/a\tb.js"))).toEqual([
      { path: "special/a\tb.js", status: "modified" },
    ]);
  });

  it("reads a path containing a newline", () => {
    expect(parseNameStatusZ(z("A", "weird/two\nlines.ts"))).toEqual([
      { path: "weird/two\nlines.ts", status: "added" },
    ]);
  });

  it("leaves a quote in the path alone instead of unescaping it", () => {
    expect(parseNameStatusZ(z("M", 'say"hi".ts'))[0]?.path).toBe('say"hi".ts');
  });

  it("takes two paths for a rename and reports the destination", () => {
    expect(parseNameStatusZ(z("R100", "old.ts", "new.ts"))).toEqual([
      { path: "new.ts", status: "renamed", oldPath: "old.ts" },
    ]);
  });

  it("takes two paths for a copy", () => {
    expect(parseNameStatusZ(z("C75", "src.ts", "copy.ts"))).toEqual([
      { path: "copy.ts", status: "copied", oldPath: "src.ts" },
    ]);
  });

  it("reads a rename followed by a plain entry without losing the boundary", () => {
    expect(parseNameStatusZ(z("R100", "plain.js", "renamed.js", "M", "special/a\tb.js"))).toEqual([
      { path: "renamed.js", status: "renamed", oldPath: "plain.js" },
      { path: "special/a\tb.js", status: "modified" },
    ]);
  });

  it("reads every simple status letter", () => {
    expect(parseNameStatusZ(z("A", "a", "M", "b", "D", "c", "T", "d")).map((f) => f.status)).toEqual([
      "added",
      "modified",
      "deleted",
      "modified",
    ]);
  });

  it("is empty for an empty diff", () => {
    expect(parseNameStatusZ("")).toEqual([]);
    expect(parseNameStatusZ("\0")).toEqual([]);
  });

  it("THROWS on a status it does not know, rather than leaving the file ungated", () => {
    expect(() => parseNameStatusZ(z("X", "mystery.ts"))).toThrow(/unknown git status/i);
  });

  it("THROWS on a rename missing its destination", () => {
    expect(() => parseNameStatusZ(z("R100", "only-one.ts"))).toThrow(/destination/i);
  });

  it("THROWS on a status with no path after it", () => {
    expect(() => parseNameStatusZ(z("M"))).toThrow();
  });
});
