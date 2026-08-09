import { describe, expect, it } from "vitest";
import { buildCharter, branchNameFor, type CharterInput } from "./charter.js";

const base: CharterInput = {
  task: "add a --quiet flag to wst status",
  worktreePath: "/tmp/wt/1/whetstone",
  branch: "run/quiet-flag",
  lane: null,
  gatingChecks: [
    { id: "typecheck", severity: "block", description: "TypeScript compiles." },
    { id: "test", severity: "block", description: "The suite passes." },
    { id: "correctness", severity: "warn", description: "No correctness bug." },
  ],
  strictPaths: ["src/core/", ".sdd/skills/"],
};

describe("buildCharter", () => {
  it("states the task and where to work", () => {
    const c = buildCharter(base);
    expect(c).toContain("add a --quiet flag to wst status");
    expect(c).toContain("/tmp/wt/1/whetstone");
    expect(c).toContain("run/quiet-flag");
  });

  // The point of a charter: the crewmate knows what will judge it BEFORE it
  // starts. A gate the worker cannot see is a trap, not a standard.
  it("tells the crewmate exactly what will gate the work", () => {
    const c = buildCharter(base);
    expect(c).toContain("typecheck");
    expect(c).toContain("test");
    expect(c).toContain("correctness");
  });

  it("distinguishes what can BLOCK from what only warns", () => {
    const c = buildCharter(base);
    const blockLine = c.split("\n").find((l) => l.includes("typecheck")) ?? "";
    const warnLine = c.split("\n").find((l) => l.includes("correctness")) ?? "";
    expect(blockLine.toLowerCase()).toContain("block");
    expect(warnLine.toLowerCase()).toContain("warn");
  });

  it("names the strict paths so the crewmate knows where TDD is mandatory", () => {
    const c = buildCharter(base);
    expect(c).toContain("src/core/");
    expect(c).toContain(".sdd/skills/");
  });

  it("points at .sdd/ rather than inlining it — progressive disclosure", () => {
    // Pasting the whole constitution into every crewmate prompt is the token
    // waste `token-economy` exists to stop. The charter is a map, not a copy.
    const c = buildCharter(base);
    expect(c).toContain("AGENTS.md");
    expect(c).toContain(".sdd/");
    expect(c.length).toBeLessThan(4000);
  });

  it("includes the lane boundary when the crewmate is in a lane", () => {
    const c = buildCharter({ ...base, lane: "receipts" });
    expect(c).toContain("receipts");
    expect(c.toLowerCase()).toContain("lane");
  });

  it("omits lane talk entirely when there is no lane", () => {
    const c = buildCharter(base);
    expect(c.toLowerCase()).not.toContain("your lane");
  });

  it("forbids the crewmate from merging or pushing", () => {
    // The crewmate produces a diff; the gate and the human decide what happens
    // to it. A worker that can merge its own work has no gate.
    const c = buildCharter(base).toLowerCase();
    expect(c).toContain("do not merge");
    expect(c).toContain("push");
  });

  it("survives a task containing quotes and newlines", () => {
    const c = buildCharter({ ...base, task: 'fix the "weird" bug\nin parse.ts' });
    expect(c).toContain('fix the "weird" bug');
  });

  it("refuses an empty task rather than dispatching a crewmate with nothing to do", () => {
    expect(() => buildCharter({ ...base, task: "   " })).toThrow(/task/i);
  });
});

/**
 * OBSERVED IN THE WILD. `wst run` produced
 *   run/fix-init-see-monorepos-and-their-tests-i
 * where the trailing `-i` is the amputated start of a word: `slice(0, 40)` cut
 * mid-word and the `-+$` strip only removed a hyphen, never the stump.
 *
 * It reads as carelessness on a branch a human has to look at in `git branch`,
 * `gh pr list` and every merge commit forever. Cut at a word boundary instead.
 */
describe("branchNameFor truncation", () => {
  it("never ends in a fragment of a word", () => {
    expect(branchNameFor("fix init see monorepos and their tests inside packages")).toBe(
      "run/fix-init-see-monorepos-and-their-tests",
    );
  });

  it("cuts at the last word that fits, not at the character limit", () => {
    const name = branchNameFor("alpha bravo charlie delta echo foxtrot golf hotel india");
    expect(name.length).toBeLessThanOrEqual("run/".length + 40);
    // Every segment present must be a whole word from the input.
    const words = new Set("alpha bravo charlie delta echo foxtrot golf hotel india".split(" "));
    for (const part of name.slice("run/".length).split("-")) expect(words.has(part)).toBe(true);
  });

  it("falls back to a hard cut when the first word alone is too long", () => {
    // No word boundary to cut at. A stump beats an empty branch name.
    const name = branchNameFor("supercalifragilisticexpialidociousandthensomemoreletters");
    expect(name.startsWith("run/supercalifragilistic")).toBe(true);
    expect(name.length).toBeLessThanOrEqual("run/".length + 40);
  });

  it("still fits a short task unchanged", () => {
    expect(branchNameFor("add a quiet flag")).toBe("run/add-a-quiet-flag");
  });
});

describe("branchNameFor", () => {
  it("slugifies a task", () => {
    expect(branchNameFor("Add a --quiet flag to wst status")).toBe(
      "run/add-a-quiet-flag-to-wst-status",
    );
  });

  it("collapses punctuation instead of emitting an invalid ref", () => {
    // `git switch -C` rejects refs with .. // or a trailing dot; a naive slug
    // would produce them and the run would die after leasing a worktree.
    const b = branchNameFor("fix: parse.ts // handles ~weird~ input!!");
    expect(b).toMatch(/^run\/[a-z0-9-]+$/);
    expect(b).not.toContain("..");
    expect(b).not.toMatch(/-$/);
  });

  it("caps the length", () => {
    expect(branchNameFor("x".repeat(200)).length).toBeLessThanOrEqual(45);
  });

  it("falls back rather than producing a bare run/", () => {
    expect(branchNameFor("!!!")).toBe("run/task");
    expect(branchNameFor("...")).toBe("run/task");
  });

  it("never leaves a trailing hyphen after truncation", () => {
    // A 40-char cut can land on a hyphen; `run/foo-` is not a valid ref.
    for (const n of [39, 40, 41, 42]) {
      expect(branchNameFor(`${"ab ".repeat(n)}`)).not.toMatch(/-$/);
    }
  });
});
