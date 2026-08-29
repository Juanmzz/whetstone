import { describe, expect, it } from "vitest";
import { MAX_LINES, SECTIONS, readPrBody } from "./body.js";

const body = (...parts: string[]): string => parts.join("\n");

const full = body(
  "## What changed",
  "It reads `workspaces` and pre-fills the source paths.",
  "",
  "## What it rules out",
  "Skipping the question. The interview would shrink when a reading got lucky.",
  "",
  "## Evidence",
  "Measured over a monorepo: two globs, one narrowed by the tree.",
  "",
  "## Verification",
  "1295 tests, typecheck, gate green.",
  "",
  "## Not verified",
  "The judge path on a repo with no README.",
);

describe("readPrBody — the sections", () => {
  it("accepts a body that uses the template", () => {
    expect(readPrBody(full).problems).toEqual([]);
  });

  it("requires `What changed`, the one section every change has", () => {
    const missing = readPrBody(body("## Evidence", "a number"));
    expect(missing.problems.join(" ")).toMatch(/What changed/);
  });

  it("refuses a heading with nothing under it", () => {
    // The template says so in its own comment: an empty heading reads as a claim
    // that there was nothing to weigh. Delete the section instead.
    const empty = readPrBody(body("## What changed", "a change", "", "## Evidence", ""));
    expect(empty.problems.join(" ")).toMatch(/Evidence.*empty|empty.*Evidence/i);
  });

  it("refuses a heading the template does not have", () => {
    const invented = readPrBody(body("## What changed", "a change", "", "## Screenshots", "none"));
    expect(invented.problems.join(" ")).toMatch(/Screenshots/);
  });

  it("names every template section it knows, so the message can list them", () => {
    expect(SECTIONS).toEqual([
      "What changed",
      "What it rules out",
      "Evidence",
      "Verification",
      "Not verified",
    ]);
  });

  it("lets a body use only the sections it has something to say in", () => {
    // "Delete any section that has nothing to say" is the template's own rule.
    expect(readPrBody(body("## What changed", "one sentence.")).problems).toEqual([]);
  });

  it("reads a heading whatever its level, since a template edit could change it", () => {
    expect(readPrBody(body("### What changed", "a change")).problems).toEqual([]);
  });
});

describe("readPrBody — the length", () => {
  it("passes a body at the ceiling and fails the one line past it", () => {
    const lines = (n: number): string =>
      body("## What changed", ...Array.from({ length: n - 1 }, (_, i) => `line ${String(i)}`));

    expect(readPrBody(lines(MAX_LINES)).problems).toEqual([]);
    expect(readPrBody(lines(MAX_LINES + 1)).problems.join(" ")).toMatch(/lines/);
  });

  it("does not count trailing blank lines, which nobody reads or writes", () => {
    const padded = `${body("## What changed", "a change")}\n${"\n".repeat(60)}`;
    expect(readPrBody(padded).problems).toEqual([]);
  });

  it("does not count an HTML comment, which is the template's own instructions", () => {
    // A body that still carries the template's guidance comment is not long; it
    // is unedited in a way this check has nothing to say about.
    const withComment = body(
      "<!--",
      ...Array.from({ length: 60 }, () => "instructions nobody reads"),
      "-->",
      "## What changed",
      "a change",
    );
    expect(readPrBody(withComment).problems).toEqual([]);
  });

  it("reports the count it measured, so the number is not a mystery", () => {
    const long = body("## What changed", ...Array.from({ length: MAX_LINES }, () => "x"));
    expect(readPrBody(long).problems.join(" ")).toContain(String(MAX_LINES + 1));
  });
});

describe("readPrBody — an empty body", () => {
  it("says the body is empty rather than listing five missing sections", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(readPrBody(empty).problems).toEqual([
        "the body is empty. Say what changed, in a sentence or two.",
      ]);
    }
  });

  it("counts a body that is only the template's comment as empty", () => {
    expect(readPrBody("<!-- delete what you have nothing to say in -->").problems).toHaveLength(1);
  });
});
