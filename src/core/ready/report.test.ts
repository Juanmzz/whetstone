import { describe, expect, it } from "vitest";
import { firstMeaningfulLine, renderReady, type ReadyFacts } from "./report.js";

const facts = (over: Partial<ReadyFacts> = {}): ReadyFacts => ({
  repo: "/repos/acme",
  branch: "feat/x",
  base: { ref: "origin/main", how: "origin/HEAD", commit: "c59ef211" },
  committed: ["src/a.ts"],
  staged: [],
  unstaged: ["src/b.ts"],
  untracked: ["src/c.ts"],
  tier: "strict",
  applicable: ["test", "typecheck"],
  results: [
    { id: "test", status: "pass", ms: 1200 },
    { id: "typecheck", status: "pass", ms: 400 },
  ],
  uncovered: [],
  evidence: [],
  elapsedMs: 1600,
  readiness: "READY",
  ...over,
});

describe("renderReady", () => {
  it("names the base ref AND the commit, so nobody has to trust the ref", () => {
    // A ref moves. The commit is what was actually compared, and a report that
    // omits it cannot be checked afterwards.
    const out = renderReady(facts());
    expect(out).toContain("origin/main");
    expect(out).toContain("c59ef211");
  });

  it("says how the base was chosen, since nobody passed it", () => {
    expect(renderReady(facts())).toContain("origin/HEAD");
  });

  it("separates committed, unstaged and untracked rather than totalling them", () => {
    // An agent that forgot to `git add` reads a total and thinks its work was
    // verified. The breakdown is what shows the file it left behind.
    const out = renderReady(facts());
    for (const word of ["committed", "unstaged", "untracked"]) expect(out).toContain(word);
  });

  it("leads with the human sentence and never with a number", () => {
    expect(renderReady(facts())).toContain("Ready");
    expect(renderReady(facts())).not.toMatch(/exit \d/);
  });

  it("says NO_CHANGES without ever saying passed", () => {
    const out = renderReady(facts({ readiness: "NO_CHANGES", committed: [], unstaged: [], untracked: [], results: [] }));
    expect(out).toContain("No changes to verify");
    expect(out.toLowerCase()).not.toContain("passed");
  });

  it("names the check that failed, because that is the next thing to do", () => {
    const out = renderReady(
      facts({ readiness: "NOT_READY", results: [{ id: "test", status: "fail", ms: 900, detail: "2 failing" }] }),
    );
    expect(out).toContain("test");
    expect(out).toContain("2 failing");
  });

  it("tells a check that could not run apart from one that failed", () => {
    // Hard rule 3, in the one line a reader sees. Sending an agent to fix code
    // when the gate is what broke wastes the whole loop.
    const out = renderReady(
      facts({ readiness: "INCOMPLETE", results: [{ id: "test", status: "errored", ms: 10, detail: "spawn failed" }] }),
    );
    expect(out).toContain("Verification incomplete");
    expect(out).toMatch(/could not run/i);
  });

  it("lists uncovered paths, which are the reason readiness was not established", () => {
    const out = renderReady(facts({ readiness: "INCOMPLETE", uncovered: ["docs/x.md"] }));
    expect(out).toContain("docs/x.md");
  });
});

describe("firstMeaningfulLine", () => {
  it("skips npm's banner, which is what a reader saw instead of the failure", () => {
    const npm = "\n> @juanmzz/whetstone@0.7.0 check:docs\n> tsx scripts/check-docs-fresh.ts\n\nclaims 10 commands: the repo has 11\n";
    expect(firstMeaningfulLine(npm)).toBe("claims 10 commands: the repo has 11");
  });

  it("returns the first line when there is no banner", () => {
    expect(firstMeaningfulLine("2 tests failed\nsee above")).toBe("2 tests failed");
  });

  it("returns nothing rather than inventing something", () => {
    expect(firstMeaningfulLine("\n\n")).toBe("");
  });
});
