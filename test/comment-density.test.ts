/**
 * The two things `comment-density` gets wrong when it guesses.
 *
 * A markdown bullet inside a template literal starts with `*`, and `init` writes
 * hundreds of them. A file with no comments at all measured 33%.
 */

import { describe, expect, it } from "vitest";
import {
  addedLines,
  addedLinesOfNewFile,
  commentLines,
  removedCommentIn,
} from "../src/core/checks/comment-density.js";

const src = (...lines: string[]): string => lines.join("\n");

describe("commentLines", () => {
  it("counts a line comment and a doc block", () => {
    const found = commentLines(src("// one", "const a = 1;", "/**", " * two", " */", "const b = 2;"));

    expect([...found].sort((x, y) => x - y)).toEqual([1, 3, 4, 5]);
  });

  it("does not count a markdown bullet inside a template literal", () => {
    const found = commentLines(src("const doc = `", "# Title", "* a bullet", "* another", "`;"));

    expect([...found]).toEqual([]);
  });

  it("does not count a comment marker inside a string", () => {
    const found = commentLines(src(`const url = "https://example.com";`, `const glob = "/* not a comment */";`));

    expect([...found]).toEqual([]);
  });

  it("does not count a trailing comment, which sits on a line of code", () => {
    expect([...commentLines(src("const a = 1; // why"))]).toEqual([]);
  });
});

describe("addedLines", () => {
  it("reads the new-side line numbers off unified=0 hunk headers", () => {
    const diff = src(
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -0,0 +1,3 @@",
      "+a",
      "+b",
      "+c",
      "@@ -9,0 +12 @@",
      "+d",
    );

    expect(addedLines(diff).get("x.ts")).toEqual([1, 2, 3, 12]);
  });

  it("keeps a file that only lost lines, with nothing added", () => {
    const diff = src("--- a/y.ts", "+++ b/y.ts", "@@ -1,2 +0,0 @@", "-gone");

    expect(addedLines(diff).get("y.ts")).toEqual([]);
  });
});

describe("a deleted file", () => {
  const diff = [
    "--- a/kept.ts",
    "+++ b/kept.ts",
    "@@ -1,0 +1 @@",
    "+// a new comment",
    "diff --git a/gone.ts b/gone.ts",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,3 +0,0 @@",
    "-// one",
    "-// two",
    "-// three",
  ].join("\n");

  it("does not donate what it removed to the file listed before it", () => {
    // `+++ /dev/null` names no file. Read naively, deleting a module hands its
    // whole comment budget to whatever file the diff happened to print first.
    expect(removedCommentIn(diff, () => true)).toBe(0);
  });

  it("contributes no added lines", () => {
    expect(addedLines(diff).get("gone.ts")).toBeUndefined();
  });
});

/**
 * `git diff` never lists a file git has not seen, so `comment-density` was blind
 * to a brand-new file: the one place comment bloat is most likely, because the
 * header essay gets written when the module is created.
 */
describe("addedLinesOfNewFile", () => {
  it("counts every line, because git has seen none of them", () => {
    expect(addedLinesOfNewFile(src("// one", "const a = 1;", "const b = 2;"))).toEqual([1, 2, 3]);
  });

  it("ignores the empty string a trailing newline leaves behind", () => {
    expect(addedLinesOfNewFile("const a = 1;\n")).toEqual([1]);
  });

  it("keeps blank lines in the middle, which the caller filters by content", () => {
    expect(addedLinesOfNewFile(src("const a = 1;", "", "const b = 2;"))).toEqual([1, 2, 3]);
  });

  it("returns nothing for an empty file", () => {
    expect(addedLinesOfNewFile("")).toEqual([]);
  });
});
