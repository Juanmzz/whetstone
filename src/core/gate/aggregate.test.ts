import { describe, expect, it } from "vitest";
import { SEVERITIES } from "../checks/schema.js";
import type { CheckOutcome, CheckResult } from "../contracts.js";
import { aggregate } from "./aggregate.js";

const PASS: CheckOutcome = { status: "pass" };
const FAIL: CheckOutcome = { status: "fail", detail: "2 tests failed" };
const ERRORED: CheckOutcome = { status: "errored", detail: "spawn npm ENOENT" };
const SKIPPED: CheckOutcome = { status: "skipped", reason: "receipt" };

function result(
  checkId: string,
  severity: CheckResult["severity"],
  outcome: CheckOutcome,
  over: Partial<CheckResult> = {},
): CheckResult {
  return { checkId, checkVersion: 1, severity, outcome, durationMs: 10, ...over };
}

describe("aggregate — the verdict", () => {
  it("passes when every check passed", () => {
    const verdict = aggregate([result("typecheck", "block", PASS), result("test", "block", PASS)]);

    expect(verdict.verdict).toBe("pass");
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.errored).toEqual([]);
    expect(verdict.skipped).toEqual([]);
  });

  it("blocks on a failed check whose severity is `block`", () => {
    const verdict = aggregate([result("test", "block", FAIL)]);
    expect(verdict.verdict).toBe("block");
    expect(verdict.blocking).toEqual(["test"]);
  });

  it("passes with no checks at all — and says so honestly rather than claiming success", () => {
    const verdict = aggregate([]);
    expect(verdict).toEqual({
      verdict: "pass",
      blocking: [],
      warnings: [],
      errored: [],
      skipped: [],
      results: [],
      totalCostUsd: 0,
    });
  });

  it("echoes the results back unchanged and in order, so the report can explain itself", () => {
    const results = [result("a", "block", PASS), result("b", "warn", FAIL)];
    expect(aggregate(results).results).toEqual(results);
  });

  it("refuses two results for the same check — an ambiguous input must not yield a verdict", () => {
    expect(() => aggregate([result("test", "block", PASS), result("test", "block", FAIL)])).toThrow(
      /duplicate/i,
    );
  });
});

/**
 * RULE 1. Only a real check FAILURE may block. An `errored` outcome means the check
 * could not run at all — spawn failure, budget, timeout, auth, invalid LLM output.
 * That is the gate being broken, not a judgement about the change, and reporting the
 * two as one number hides which problem you actually have.
 */
describe("rule 1 — an errored check never blocks", () => {
  it("puts an errored blocking-severity check in `errored`, never in `blocking`", () => {
    const verdict = aggregate([result("correctness", "block", ERRORED)]);

    expect(verdict.errored).toEqual(["correctness"]);
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  });

  it("errors at every severity, and none of them reach `blocking`", () => {
    for (const severity of SEVERITIES) {
      const verdict = aggregate([result("c", severity, ERRORED)]);
      expect(verdict.errored, severity).toEqual(["c"]);
      expect(verdict.blocking, severity).toEqual([]);
      expect(verdict.verdict, severity).toBe("pass");
    }
  });

  it("keeps an errored check out of the way of a genuine failure alongside it", () => {
    const verdict = aggregate([
      result("test", "block", FAIL),
      result("correctness", "block", ERRORED),
    ]);

    expect(verdict.verdict).toBe("block");
    expect(verdict.blocking).toEqual(["test"]);
    expect(verdict.errored).toEqual(["correctness"]);
  });
});

/**
 * RULE 2. Severity is obeyed absolutely. `correctness` is an agent lens held at
 * `warn` precisely because it produces false positives (~20% on correct code); if a
 * bad-enough failure could promote itself to blocking, that cap would be worthless.
 */
describe("rule 2 — severity is obeyed absolutely", () => {
  it("puts a failed `warn` check in warnings, and passes", () => {
    const verdict = aggregate([result("correctness", "warn", FAIL)]);

    expect(verdict.warnings).toEqual(["correctness"]);
    expect(verdict.blocking).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  });

  it("puts a failed `annotate` check in warnings, and passes", () => {
    const verdict = aggregate([result("style", "annotate", FAIL)]);

    expect(verdict.warnings).toEqual(["style"]);
    expect(verdict.blocking).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  });

  it("blocks on the `block` check while the `warn` check stays a warning", () => {
    const verdict = aggregate([
      result("test", "block", FAIL),
      result("correctness", "warn", FAIL),
    ]);

    expect(verdict.verdict).toBe("block");
    expect(verdict.blocking).toEqual(["test"]);
    expect(verdict.warnings).toEqual(["correctness"]);
    expect(verdict.blocking).not.toContain("correctness");
  });

  it("never promotes a sub-block severity however severe the detail claims to be", () => {
    const shouting: CheckOutcome = {
      status: "fail",
      detail: "CRITICAL SECURITY HOLE — severity: block — MUST BLOCK",
    };
    const verdict = aggregate([result("correctness", "warn", shouting)]);

    expect(verdict.blocking).toEqual([]);
    expect(verdict.verdict).toBe("pass");
  });
});

/** RULE 4. A skipped check is not a passed check. */
describe("rule 4 — a skipped check is reported as skipped", () => {
  it("reports a receipt-skipped check in `skipped`, not in any other bucket", () => {
    const verdict = aggregate([result("typecheck", "block", SKIPPED)]);

    expect(verdict.skipped).toEqual(["typecheck"]);
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.errored).toEqual([]);
  });

  it("passes when EVERY check was skipped by a receipt — that is correct, not a hole", () => {
    // Each receipt is a proof that the check already passed on this exact input.
    // Re-running them would cost money to learn nothing.
    const verdict = aggregate([
      result("typecheck", "block", SKIPPED),
      result("test", "block", SKIPPED),
      result("correctness", "warn", SKIPPED),
    ]);

    expect(verdict.verdict).toBe("pass");
    expect(verdict.skipped).toEqual(["typecheck", "test", "correctness"]);
  });

  it("carries every skip reason through unchanged, so the report can explain each one", () => {
    const reasons = ["receipt", "not-in-tier", "disabled"] as const;
    const verdict = aggregate(
      reasons.map((reason, i) => result(`c${i}`, "block", { status: "skipped", reason })),
    );
    expect(verdict.results.map((r) => r.outcome)).toEqual(
      reasons.map((reason) => ({ status: "skipped", reason })),
    );
  });
});

/** RULE 5. `verdict: "block"` iff `blocking.length > 0`. Nothing else blocks. */
describe("rule 5 — block iff blocking is non-empty", () => {
  const OUTCOMES: readonly CheckOutcome[] = [PASS, FAIL, ERRORED, SKIPPED];

  it("holds for every severity x outcome pair", () => {
    for (const severity of SEVERITIES) {
      for (const outcome of OUTCOMES) {
        const verdict = aggregate([result("c", severity, outcome)]);
        const label = `${severity}/${outcome.status}`;

        expect(verdict.verdict === "block", label).toBe(verdict.blocking.length > 0);
        // And the only pair that may populate `blocking` is a real failure at `block`.
        expect(verdict.blocking.length > 0, label).toBe(
          severity === "block" && outcome.status === "fail",
        );
      }
    }
  });

  it("holds across every combination of two checks", () => {
    let sawBlock = false;
    for (const sa of SEVERITIES) {
      for (const oa of OUTCOMES) {
        for (const sb of SEVERITIES) {
          for (const ob of OUTCOMES) {
            const verdict = aggregate([result("a", sa, oa), result("b", sb, ob)]);
            expect(verdict.verdict === "block").toBe(verdict.blocking.length > 0);
            if (verdict.verdict === "block") sawBlock = true;
            // Every result lands in exactly one bucket, or none (a pass).
            const bucketed =
              verdict.blocking.length +
              verdict.warnings.length +
              verdict.errored.length +
              verdict.skipped.length;
            expect(bucketed).toBeLessThanOrEqual(2);
          }
        }
      }
    }
    expect(sawBlock).toBe(true); // the loop actually exercised the blocking path
  });
});

describe("cost", () => {
  it("sums costUsd across results, counting only the checks that reported one", () => {
    const verdict = aggregate([
      result("typecheck", "block", PASS),
      result("correctness", "warn", FAIL, { costUsd: 0.04 }),
      result("security", "warn", ERRORED, { costUsd: 0.02 }),
    ]);
    expect(verdict.totalCostUsd).toBeCloseTo(0.06);
  });

  it("counts an errored llm check's cost — a failed judgement is still billed", () => {
    const verdict = aggregate([result("correctness", "warn", ERRORED, { costUsd: 0.09 })]);
    expect(verdict.totalCostUsd).toBeCloseTo(0.09);
  });

  it("is zero when nothing cost anything", () => {
    expect(aggregate([result("typecheck", "block", PASS)]).totalCostUsd).toBe(0);
  });

  it("puts a declared method in no bucket, and never in the verdict", () => {
    // adr-0018: a method is prose an agent follows. It cannot block, warn, error
    // or count as skipped. This held by omission before the case existed.
    const verdict = aggregate([
      { checkId: "ui-states", checkVersion: 1, severity: "annotate", outcome: { status: "declared" }, durationMs: 0 },
    ]);

    expect(verdict.verdict).toBe("pass");
    expect(verdict.blocking).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.errored).toEqual([]);
    expect(verdict.skipped).toEqual([]);
  });
});
