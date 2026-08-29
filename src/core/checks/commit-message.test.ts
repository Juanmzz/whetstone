import { describe, expect, it } from "vitest";
import { judgeCommits, TYPES, type Commit } from "./commit-message.js";

const commit = (subject: string, body = ""): Commit => ({ sha: "abc1234", subject, body });
const kinds = (...c: Commit[]): string[] => judgeCommits(c).map((f) => f.kind);

describe("judgeCommits, the conventional subject", () => {
  it("passes the shape the repo already writes", () => {
    // 332 of 333 commits and 60 of the last 60 already match, so this is a rule
    // being held rather than one being introduced.
    expect(kinds(commit("fix(banner): draw the mark in half blocks"))).toEqual([]);
  });

  it("takes a subject with no scope, and one marked breaking", () => {
    expect(kinds(commit("docs: a PR template"), commit("feat!: drop the plan command"))).toEqual([]);
  });

  it("rejects a subject with no type at all", () => {
    expect(kinds(commit("draw the mark in half blocks"))).toEqual(["not-conventional"]);
  });

  it("rejects a type nothing recognises, rather than any lowercase word", () => {
    // The guard in the other direction: `fix:` is fine, `wip:` is not, and both
    // match the same shape.
    expect(kinds(commit("wip: half done"))).toEqual(["unknown-type"]);
    expect(kinds(commit("fix: done"))).toEqual([]);
  });

  it("rejects an empty description after the colon", () => {
    expect(kinds(commit("fix: "))).toEqual(["not-conventional"]);
  });

  it("knows every type the repo has actually used", () => {
    const used = ["feat", "fix", "docs", "chore", "test", "refactor", "build", "ci", "perf"];

    expect(used.filter((t) => !TYPES.includes(t as (typeof TYPES)[number]))).toEqual([]);
  });
});

describe("judgeCommits, AI attribution", () => {
  it("rejects the trailer that puts a model's name on the author's commit", () => {
    const found = judgeCommits([
      commit("fix: a thing", "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"),
    ]);

    expect(found.map((f) => f.kind)).toEqual(["ai-attribution"]);
  });

  it("rejects the generated-with footer, emoji or not", () => {
    const body = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

    expect(kinds(commit("fix: a thing", body))).toEqual(["ai-attribution"]);
  });

  it("lets a body that MENTIONS the tool through, because naming is not crediting", () => {
    // Five of the nine matches in this repo's history were prose like this. A
    // check that cannot tell them apart makes the subject undiscussable.
    const body =
      "The hook script lived only in the Claude Code skill, so a repo bootstrapped\n" +
      "any other way had nothing to arm. Claude Code finds a plugin by its manifest.";

    expect(kinds(commit("fix: seed the hook", body))).toEqual([]);
  });

  it("lets a human co-author through, which is what the trailer is for", () => {
    const body = "Co-Authored-By: Ada Lovelace <ada@example.com>";

    expect(kinds(commit("feat: a thing", body))).toEqual([]);
  });

  it("names the offending line, so the fix does not need a hunt", () => {
    const found = judgeCommits([
      commit("fix: a thing", "some prose\n\nCo-Authored-By: Claude <noreply@anthropic.com>"),
    ]);

    expect(found[0]?.detail).toContain("Co-Authored-By: Claude");
  });
});

describe("judgeCommits, over a range", () => {
  it("reports every commit that fails, not just the first", () => {
    const found = judgeCommits([
      commit("nope, no type"),
      commit("fix: fine"),
      commit("also bad"),
    ]);

    expect(found).toHaveLength(2);
  });

  it("carries the sha, because a range is where you have to find it", () => {
    const found = judgeCommits([{ sha: "deadbee", subject: "bad", body: "" }]);

    expect(found[0]?.sha).toBe("deadbee");
  });

  it("says nothing about an empty range", () => {
    expect(judgeCommits([])).toEqual([]);
  });
});
