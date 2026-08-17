import { describe, expect, it } from "vitest";
import { environmentGaps } from "./environment.js";

describe("environmentGaps — how a leased worktree differs from the tree it came from", () => {
  it("names nested node_modules, which a root symlink does not cover", () => {
    // npm hoists most deps to the root but not all: a workspace keeps its own
    // node_modules, the worktree has neither, and a BLOCKING typecheck fails on
    // 'Cannot find module' in a file the worker never touched.
    const gaps = environmentGaps({
      untracked: ["node_modules", "apps/api/node_modules", "packages/shared/node_modules"],
      linked: ["node_modules"],
    });

    const nested = gaps.find((g) => g.kind === "nested-dependencies");
    expect(nested?.paths).toEqual(["apps/api/node_modules", "packages/shared/node_modules"]);
  });

  it("says nothing about nesting when the root link is the whole story", () => {
    const gaps = environmentGaps({ untracked: ["node_modules"], linked: ["node_modules"] });

    expect(gaps.filter((g) => g.kind === "nested-dependencies")).toEqual([]);
  });

  it("names ignored env files, which never propagate to a worktree", () => {
    // A test that self-skips without a key PASSES in the worktree and FAILS for
    // whoever pulls the branch. A green that means 'skipped' is the worst green.
    const gaps = environmentGaps({
      untracked: ["node_modules", ".env", "apps/api/.env.local"],
      linked: ["node_modules"],
    });

    const env = gaps.find((g) => g.kind === "absent-environment");
    expect(env?.paths).toEqual([".env", "apps/api/.env.local"]);
  });

  it("is quiet when a worktree matches its origin", () => {
    expect(environmentGaps({ untracked: ["node_modules"], linked: ["node_modules"] })).toEqual([]);
  });

  it("explains the consequence, not just the path", () => {
    const [gap] = environmentGaps({ untracked: ["node_modules", ".env"], linked: ["node_modules"] });

    expect(gap?.why.length).toBeGreaterThan(20);
  });
});
