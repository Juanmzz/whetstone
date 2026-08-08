import { describe, expect, it } from "vitest";
import type { CheckOutcome, CheckResult, GateVerdict } from "../contracts.js";
import { aggregate } from "../gate/aggregate.js";
import { attributeFindings, type CheckCoverage } from "./findings.js";

function result(
  checkId: string,
  severity: CheckResult["severity"],
  outcome: CheckOutcome,
): CheckResult {
  return { checkId, checkVersion: 1, severity, outcome, durationMs: 1 };
}

const verdictOf = (...results: CheckResult[]): GateVerdict => aggregate(results);

const covering = (checkId: string, ...paths: string[]): CheckCoverage => ({ checkId, paths });

describe("attributeFindings", () => {
  it("pulls the file and line out of a compiler-shaped failure", () => {
    const verdict = verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "src/core/gate/run.ts:112:7 - error TS2345: Argument of type ...",
      }),
    );

    const { attributed, unattributed } = attributeFindings(verdict, [
      covering("typecheck", "src/core/gate/run.ts", "src/core/gate/select.ts"),
    ]);

    expect(unattributed).toEqual([]);
    expect(attributed).toEqual([
      {
        checkId: "typecheck",
        severity: "block",
        detail: "src/core/gate/run.ts:112:7 - error TS2345: Argument of type ...",
        path: "src/core/gate/run.ts",
        line: 112,
      },
    ]);
  });

  it("attributes to EVERY file the failure actually names, and no others", () => {
    const verdict = verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "src/a.ts:3:1 - error TS1\nsrc/b.ts:9:1 - error TS2",
      }),
    );

    const { attributed } = attributeFindings(verdict, [
      covering("typecheck", "src/a.ts", "src/b.ts", "src/c.ts"),
    ]);

    expect(attributed.map((f) => `${f.path}:${String(f.line)}`)).toEqual(["src/a.ts:3", "src/b.ts:9"]);
  });

  /**
   * THE RULE THAT KEEPS THE SIGNAL. A check covers N files; its failure names one.
   * Spreading the finding across the whole coverage set is `max()` wearing a
   * different hat — it repaints every file the check touched.
   */
  it("does NOT spread a finding across the other files the check covered", () => {
    const verdict = verdictOf(
      result("typecheck", "block", { status: "fail", detail: "src/b.ts:9:1 - error TS2" }),
    );
    const coverage = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);

    const { attributed } = attributeFindings(verdict, [
      covering("typecheck", "src/b.ts", ...coverage),
    ]);

    expect(attributed).toHaveLength(1);
    expect(attributed[0]?.path).toBe("src/b.ts");
  });

  it("ignores a path the check did not cover — a failure may quote unrelated code", () => {
    const verdict = verdictOf(
      result("test", "block", {
        status: "fail",
        detail: "expected node_modules/vendor/thing.js:4 to equal src/a.ts:7",
      }),
    );

    const { attributed } = attributeFindings(verdict, [covering("test", "src/a.ts")]);
    expect(attributed.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  it("matches an absolute path printed by a tool against the repo-relative coverage", () => {
    const verdict = verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "/Users/x/repo/src/core/gate/run.ts:9:1 - error TS1",
      }),
    );

    const { attributed } = attributeFindings(verdict, [covering("typecheck", "src/core/gate/run.ts")]);
    expect(attributed.map((f) => f.path)).toEqual(["src/core/gate/run.ts"]);
  });

  it("attributes a bare path with no line number", () => {
    const verdict = verdictOf(
      result("correctness", "warn", {
        status: "fail",
        detail: "The retry in src/core/orchestrate/judge.ts double-counts cost.",
      }),
    );

    const { attributed } = attributeFindings(verdict, [
      covering("correctness", "src/core/orchestrate/judge.ts"),
    ]);
    expect(attributed[0]).toEqual({
      checkId: "correctness",
      severity: "warn",
      detail: "The retry in src/core/orchestrate/judge.ts double-counts cost.",
      path: "src/core/orchestrate/judge.ts",
    });
    expect(attributed[0]).not.toHaveProperty("line");
  });

  it("de-duplicates repeated mentions of the same file and line", () => {
    const verdict = verdictOf(
      result("test", "block", {
        status: "fail",
        detail: "src/a.ts:3:1 failed\n  at src/a.ts:3:1\n  at src/a.ts:3:9",
      }),
    );
    const { attributed } = attributeFindings(verdict, [covering("test", "src/a.ts")]);
    expect(attributed).toHaveLength(1);
  });

  /**
   * The honest answer to "which file should I look at" is sometimes "we cannot tell".
   * Guessing — by spreading it over the coverage set — would be a lie with a red
   * marker on it.
   */
  it("reports a failure naming no covered file as UNATTRIBUTED, not as a red file", () => {
    const verdict = verdictOf(
      result("test", "block", { status: "fail", detail: "3 tests failed" }),
    );

    const { attributed, unattributed } = attributeFindings(verdict, [
      covering("test", "src/a.ts", "src/b.ts"),
    ]);

    expect(attributed).toEqual([]);
    expect(unattributed).toEqual([
      { checkId: "test", severity: "block", detail: "3 tests failed", path: null },
    ]);
  });

  it("an ERRORED check is not a finding — it never appears in either list", () => {
    const verdict = verdictOf(
      result("correctness", "block", {
        status: "errored",
        detail: "the review lens produced no usable verdict (timeout): src/a.ts:1",
      }),
    );

    expect(attributeFindings(verdict, [covering("correctness", "src/a.ts")])).toEqual({
      attributed: [],
      unattributed: [],
    });
  });

  it("a skipped or passing check is not a finding", () => {
    const verdict = verdictOf(
      result("typecheck", "block", { status: "pass" }),
      result("test", "block", { status: "skipped", reason: "receipt" }),
    );
    expect(attributeFindings(verdict, [covering("typecheck", "src/a.ts")])).toEqual({
      attributed: [],
      unattributed: [],
    });
  });

  it("a check with no recorded coverage cannot attribute anything", () => {
    const verdict = verdictOf(
      result("typecheck", "block", { status: "fail", detail: "src/a.ts:3:1 - error TS1" }),
    );
    const { attributed, unattributed } = attributeFindings(verdict, []);
    expect(attributed).toEqual([]);
    expect(unattributed.map((f) => f.checkId)).toEqual(["typecheck"]);
  });

  it("is stable — the same verdict attributes identically twice", () => {
    const verdict = verdictOf(
      result("typecheck", "block", { status: "fail", detail: "src/b.ts:9\nsrc/a.ts:3" }),
    );
    const coverage = [covering("typecheck", "src/a.ts", "src/b.ts")];
    expect(attributeFindings(verdict, coverage)).toEqual(attributeFindings(verdict, coverage));
  });
});
