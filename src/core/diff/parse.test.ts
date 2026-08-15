import { describe, expect, it } from "vitest";
import { parseNameStatus } from "./parse.js";

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
