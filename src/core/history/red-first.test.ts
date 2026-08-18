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
const inScope = (path: string): boolean => path.startsWith("src/core/");

const violations = (
  commits: readonly HistoryCommit[],
  testedAtBase: readonly string[] = [],
): ReturnType<typeof findRedFirstViolations> =>
  findRedFirstViolations(commits, { inScope, testedAtBase });

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

  /**
   * Measured, not chosen ([TD7]). Run unfiltered over this repo, `no-test` on a
   * MODIFIED file reported `ports.ts` and `contracts.ts` — type declarations with
   * no behaviour to test — and did so on every future edit to them. A check that
   * fires forever on work it can never be satisfied by is the permanently-warning
   * check `core/init/checks.ts` calls noise, and noise is what makes the real
   * finding unreadable.
   *
   * The narrowing is principled, not a mute: editing a module that never had a
   * test is a pre-existing coverage hole, and this check is about the ORDER of a
   * test and the code it covers. A NEW module arriving untested is that, and is
   * still reported below.
   */
  it("does not flag an edit to a module that never had a test", () => {
    expect(
      violations([commit("aaa", "refactor: tidy types", f("src/core/contracts.ts", "modified"))]),
    ).toEqual([]);
  });

  it("still flags a NEW module that arrives with no test", () => {
    const found = violations([
      commit("aaa", "feat: a new module", f("src/core/gate/fresh.ts", "added")),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "no-test" });
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

/**
 * The rule this measures changed under it.
 *
 * When this was written, hard rule 4 read "RED first, in its own commit", so a
 * test landing WITH its implementation was a discipline miss. On 2026-08-14 the
 * retro amended [TD1]/[TD2] against `sig-e8dfefd0` — the repo owner had said three
 * times that separate RED and GREEN commits are unwanted, and the rule as written
 * was producing the thing it existed to prevent. One commit per coherent change,
 * with the red output quoted in the body, is now the discipline.
 *
 * So `same-commit` stopped being a violation and became the expected shape. Run
 * unchanged over 74 real commits it reported 9 findings, every one of them a
 * correct commit and none of them a defect: a check red on the right answer.
 */
describe("findRedFirstViolations — after the rule stopped asking for two commits", () => {
  const strict = (path: string) => path.startsWith("src/core/") && path.endsWith(".ts");

  it("says nothing when the test lands with its implementation", () => {
    const history = [
      {
        sha: "a1",
        subject: "feat(x): a coherent change",
        files: [
          { path: "src/core/x/thing.ts", status: "added" as const },
          { path: "src/core/x/thing.test.ts", status: "added" as const },
        ],
      },
    ];

    expect(findRedFirstViolations(history, { inScope: strict, testedAtBase: [] })).toEqual([]);
  });

  it("still reports implementation that arrives with no test at all", () => {
    const history = [
      { sha: "a1", subject: "feat(x): no test", files: [{ path: "src/core/x/thing.ts", status: "added" as const }] },
    ];

    const found = findRedFirstViolations(history, { inScope: strict, testedAtBase: [] });

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("no-test");
  });
});
