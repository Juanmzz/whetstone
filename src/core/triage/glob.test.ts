import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchesPathGlob } from "./glob.js";

describe("matchesPathGlob", () => {
  it("matches a directory prefix pattern", () => {
    expect(matchesPathGlob("src/core/triage/classify.ts", "src/core/**")).toBe(true);
    expect(matchesPathGlob("src/shell/git.ts", "src/core/**")).toBe(false);
  });

  it("matches an exact path", () => {
    expect(matchesPathGlob("docs/PARALLEL.md", "docs/PARALLEL.md")).toBe(true);
    expect(matchesPathGlob("docs/OTHER.md", "docs/PARALLEL.md")).toBe(false);
  });

  it("normalises a leading ./ so a relative diff path still matches", () => {
    // node:path matchesGlob is literal string matching: "./src/a.ts" does NOT
    // match "src/**". `git diff --name-status` emits clean repo-relative paths,
    // but anything hand-assembled (a test, a `--files` flag) easily grows a "./"
    // prefix, and a triage rule that silently stops matching is the worst kind of
    // bug in a gate — the file is simply never classified strict.
    expect(matchesPathGlob("./src/core/a.ts", "src/core/**")).toBe(true);
    expect(matchesPathGlob(".//src/core/a.ts", "src/core/**")).toBe(true);
  });

  it("matches dot-leading directories when the pattern spells the dot out", () => {
    // MEASURED, and load-bearing for the default ruleset: `**` does NOT cross a
    // dot-leading segment (".wst/x.md" vs "**" is false), but ".wst/skills/**"
    // does match. Every rule covering .wst/ or .claude/ must therefore name the
    // dotted segment literally — and a catch-all "**" rule would NOT be a
    // catch-all, which is why the unmatched-file fallback lives in code.
    expect(matchesPathGlob(".wst/skills/tdd-discipline.md", ".wst/skills/**")).toBe(true);
    expect(matchesPathGlob(".claude/hooks/lane-guard.mjs", ".claude/hooks/**")).toBe(true);
    expect(matchesPathGlob(".wst/skills/tdd-discipline.md", "**")).toBe(false);
  });

  it("is case sensitive, like the paths git reports", () => {
    expect(matchesPathGlob("src/core/a.ts", "SRC/core/**")).toBe(false);
  });

  it("returns false for a malformed pattern rather than throwing", () => {
    // Documents the hazard: node:path swallows a bad pattern, so a typo'd glob is
    // a DEAD RULE, not a crash. Nothing downstream can detect that, so it is
    // called out here and in the loader's docs.
    expect(matchesPathGlob("src/core/a.ts", "src/core/[")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("is true when any pattern matches", () => {
    expect(matchesAnyGlob("src/core/a.ts", ["test/**", "src/core/**"])).toBe(true);
  });

  it("is false when none match", () => {
    expect(matchesAnyGlob("README.md", ["test/**", "src/core/**"])).toBe(false);
  });

  it("is false for an empty pattern list", () => {
    // An empty `include` must select nothing. Treating it as "match everything"
    // would make a check with a mis-typed include run against the whole repo.
    expect(matchesAnyGlob("README.md", [])).toBe(false);
  });
});
