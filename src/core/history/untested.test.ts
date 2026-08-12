import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../diff/parse.js";
import {
  findUntestedArrivals,
  isTestPath,
  moduleKey,
  type HistoryCommit,
} from "./untested.js";

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
const inScope = (path: string): boolean => path.startsWith("src/core/");

const arrivals = (
  commits: readonly HistoryCommit[],
  testedAtBase: readonly string[] = [],
): ReturnType<typeof findUntestedArrivals> =>
  findUntestedArrivals(commits, { inScope, testedAtBase });

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

describe("a strict module that arrived with nothing covering it", () => {
  it("reports a new module no commit has tested", () => {
    const found = arrivals([
      commit("aaa", "feat: a thing", f("src/core/gate/run.ts", "added")),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sha: "aaa",
      file: "src/core/gate/run.ts",
      module: "src/core/gate/run",
    });
  });

  /**
   * The GREEN direction, and the one [TD7] says a guard is not trusted without:
   * proving what it rejects says nothing about what it lets through.
   */
  it("accepts a module whose test arrived in an earlier commit", () => {
    expect(
      arrivals([
        commit("aaa", "test: cover the thing", f("src/core/gate/run.test.ts", "added")),
        commit("bbb", "feat: the thing", f("src/core/gate/run.ts", "added")),
      ]),
    ).toEqual([]);
  });

  /**
   * The behaviour that replaced `same-commit`. Landing the test alongside the
   * code is a commit-shape preference, not a coverage hole, and this check is
   * about coverage. Enforcing the shape belongs in a decision, not here.
   */
  it("accepts a module whose test arrives in the same commit", () => {
    expect(
      arrivals([
        commit(
          "aaa",
          "feat: the thing, with its test",
          f("src/core/gate/run.ts", "added"),
          f("src/core/gate/run.test.ts", "added"),
        ),
      ]),
    ).toEqual([]);
  });

  it("accepts a module already tested before the range began", () => {
    expect(
      arrivals(
        [commit("aaa", "feat: moved here", f("src/core/gate/run.ts", "added"))],
        ["src/core/gate/run"],
      ),
    ).toEqual([]);
  });

  it("does not let a test in a LATER commit excuse the arrival before it", () => {
    const found = arrivals([
      commit("aaa", "feat: a thing", f("src/core/gate/run.ts", "added")),
      commit("bbb", "test: cover it, eventually", f("src/core/gate/run.test.ts", "added")),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sha: "aaa" });
  });

  it("does not flag an edit to a module that never had a test", () => {
    expect(
      arrivals([commit("aaa", "refactor: tidy types", f("src/core/contracts.ts", "modified"))]),
    ).toEqual([]);
  });

  it("ignores files outside the strict tier", () => {
    expect(
      arrivals([commit("aaa", "feat: adapter", f("src/shell/git.ts", "added"))]),
    ).toEqual([]);
  });

  it("ignores a deletion", () => {
    expect(
      arrivals([commit("aaa", "refactor: drop dead code", f("src/core/gate/old.ts", "deleted"))]),
    ).toEqual([]);
  });

  it("never flags a test-only commit", () => {
    expect(
      arrivals([commit("aaa", "test: a guard", f("src/core/gate/run.test.ts", "added"))]),
    ).toEqual([]);
  });

  it("reports one arrival per file, not per commit", () => {
    const found = arrivals([
      commit(
        "aaa",
        "feat: two modules",
        f("src/core/gate/run.ts", "added"),
        f("src/core/gate/select.ts", "added"),
      ),
    ]);

    expect(found.map((a) => a.module)).toEqual(["src/core/gate/run", "src/core/gate/select"]);
  });
});
