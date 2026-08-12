import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../diff/parse.js";
import {
  findRedFirstViolations,
  isTestPath,
  moduleKey,
  type HistoryCommit,
} from "./red-first.js";

const f = (path: string, status: ChangedFile["status"] = "modified"): ChangedFile => ({
  path,
  status,
});

const commit = (sha: string, subject: string, ...files: ChangedFile[]): HistoryCommit => ({
  sha,
  subject,
  files,
});

/** Everything under src/core is strict here, matching this repo's triage.yaml. */
const isStrict = (path: string): boolean => path.startsWith("src/core/");

const violations = (
  commits: readonly HistoryCommit[],
  testedAtBase: readonly string[] = [],
): ReturnType<typeof findRedFirstViolations> =>
  findRedFirstViolations(commits, { isStrict, testedAtBase });

describe("pairing a module with its test", () => {
  it("maps an implementation path and its colocated test to the same module", () => {
    expect(moduleKey("src/core/gate/run.ts")).toBe("src/core/gate/run");
    expect(moduleKey("src/core/gate/run.test.ts")).toBe("src/core/gate/run");
  });

  it("does not treat a module whose name ends in test as a test file", () => {
    expect(isTestPath("src/core/gate/run.test.ts")).toBe(true);
    expect(isTestPath("src/core/latest.ts")).toBe(false);
    expect(moduleKey("src/core/latest.ts")).toBe("src/core/latest");
  });
});

describe("RED first, measured over a sequence of commits", () => {
  it("flags implementation whose module no earlier commit had tested", () => {
    const found = violations([commit("aaa", "feat: a thing", f("src/core/gate/run.ts", "added"))]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sha: "aaa",
      file: "src/core/gate/run.ts",
      module: "src/core/gate/run",
      kind: "no-test",
    });
  });

  it("flags implementation that arrives in the same commit as its own test", () => {
    const found = violations([
      commit(
        "bbb",
        "feat: a thing, tested",
        f("src/core/gate/run.ts", "added"),
        f("src/core/gate/run.test.ts", "added"),
      ),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sha: "bbb", kind: "same-commit" });
  });

  /**
   * The GREEN direction, and the one [TD7] says a guard is not trusted without:
   * proving what it rejects says nothing about what it lets through.
   */
  it("accepts implementation preceded by a commit touching its test", () => {
    expect(
      violations([
        commit("aaa", "test: RED — a thing", f("src/core/gate/run.test.ts", "added")),
        commit("bbb", "feat: GREEN — a thing", f("src/core/gate/run.ts", "added")),
      ]),
    ).toEqual([]);
  });

  it("accepts implementation whose module was already tested before the range began", () => {
    expect(
      violations(
        [commit("bbb", "refactor: tidy", f("src/core/gate/run.ts"))],
        ["src/core/gate/run"],
      ),
    ).toEqual([]);
  });

  it("does not let a test in a LATER commit excuse the implementation before it", () => {
    const found = violations([
      commit("aaa", "feat: a thing", f("src/core/gate/run.ts", "added")),
      commit("bbb", "test: cover the thing", f("src/core/gate/run.test.ts", "added")),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sha: "aaa", kind: "no-test" });
  });

  it("ignores files outside the strict tier", () => {
    expect(
      violations([commit("aaa", "feat: adapter", f("src/shell/git.ts", "added"))]),
    ).toEqual([]);
  });

  it("ignores a commit that only deletes implementation", () => {
    expect(
      violations([commit("aaa", "refactor: drop dead code", f("src/core/gate/old.ts", "deleted"))]),
    ).toEqual([]);
  });

  it("never flags a test-only commit", () => {
    expect(
      violations([commit("aaa", "test: RED", f("src/core/gate/run.test.ts", "added"))]),
    ).toEqual([]);
  });

  it("reports one violation per implementation file, not per commit", () => {
    const found = violations([
      commit(
        "aaa",
        "feat: two modules",
        f("src/core/gate/run.ts", "added"),
        f("src/core/gate/select.ts", "added"),
      ),
    ]);

    expect(found.map((v) => v.module)).toEqual(["src/core/gate/run", "src/core/gate/select"]);
  });
});
