import { describe, expect, it } from "vitest";
import type { CheckOutcome, CheckResult } from "../contracts.js";
import { aggregate } from "./aggregate.js";
import {
  EXIT_BLOCKED,
  EXIT_INCOMPLETE,
  EXIT_PASS,
  exitCodeFor,
  renderGateRun,
} from "./report.js";
import type { GateRun } from "./run.js";
import type { Selection } from "./select.js";

const EMPTY_SELECTION: Selection = { selected: [], excluded: [], unknown: [], unmatched: [] };

function result(
  checkId: string,
  severity: CheckResult["severity"],
  outcome: CheckOutcome,
  over: Partial<CheckResult> = {},
): CheckResult {
  return { checkId, checkVersion: 1, severity, outcome, durationMs: 120, ...over };
}

const gateRun = (results: CheckResult[], over: Partial<GateRun> = {}): GateRun => ({
  verdict: aggregate(results),
  selection: EMPTY_SELECTION,
  receiptsWritten: [],
  receiptErrors: [],
  ...over,
});

describe("renderGateRun", () => {
  it("states the verdict and names every blocking check with its reason", () => {
    const text = renderGateRun(
      gateRun([
        result("typecheck", "block", { status: "pass" }),
        result("test", "block", { status: "fail", detail: "2 tests failed" }),
      ]),
    );

    expect(text).toMatch(/BLOCKED/);
    expect(text).toContain("test");
    expect(text).toContain("2 tests failed");
  });

  it("says pass when nothing blocked", () => {
    const text = renderGateRun(gateRun([result("typecheck", "block", { status: "pass" })]));
    expect(text).toMatch(/passed/i);
    expect(text).not.toMatch(/BLOCKED/);
  });

  it("labels warnings as advisory and does NOT present them as blockers", () => {
    const text = renderGateRun(
      gateRun([result("correctness", "warn", { status: "fail", detail: "maybe an off-by-one" })]),
    );

    expect(text).toMatch(/passed/i);
    expect(text).toMatch(/warn/i);
    expect(text).toContain("maybe an off-by-one");
    expect(text).not.toMatch(/BLOCKED/);
  });

  it("reports an errored check as the GATE being broken, not as a failed check", () => {
    // A user who reads this must not conclude their change is fine. It was not
    // fully verified, and the message has to say so in those words.
    const text = renderGateRun(
      gateRun([result("correctness", "block", { status: "errored", detail: "budget exhausted" })]),
    );

    expect(text).toMatch(/could not run|not verified/i);
    expect(text).toContain("budget exhausted");
    expect(text).not.toMatch(/BLOCKED/);
  });

  it("explains WHY each check was skipped rather than counting it as a pass", () => {
    const text = renderGateRun(
      gateRun([
        result("typecheck", "block", { status: "skipped", reason: "receipt" }),
        result("style", "warn", { status: "skipped", reason: "disabled" }),
      ]),
    );

    expect(text).toContain("receipt");
    expect(text).toContain("disabled");
  });

  it("is honest when nothing ran at all — no check is not the same as everything passed", () => {
    const text = renderGateRun(
      gateRun([], {
        selection: { ...EMPTY_SELECTION, unmatched: ["typecheck", "test"] },
      }),
    );

    expect(text).toMatch(/no checks? (applied|matched)/i);
    expect(text).toContain("typecheck");
    // It may say "passed" — that is the honest verdict — but it must NOT let the
    // reader infer that anything was verified.
    expect(text).toMatch(/nothing about this change was verified/i);
  });

  it("names the checks that matched no file, so a broken glob cannot hide", () => {
    const text = renderGateRun(
      gateRun([result("typecheck", "block", { status: "pass" })], {
        selection: { ...EMPTY_SELECTION, unmatched: ["correctness"] },
      }),
    );
    expect(text).toContain("correctness");
  });

  it("reports the cost only when something was actually billed", () => {
    const free = renderGateRun(gateRun([result("typecheck", "block", { status: "pass" })]));
    expect(free).not.toMatch(/\$/);

    const billed = renderGateRun(
      gateRun([result("correctness", "warn", { status: "pass" }, { costUsd: 0.042 })]),
    );
    expect(billed).toMatch(/\$0\.04/);
  });

  it("reports receipts written, and receipts that could not be persisted", () => {
    const text = renderGateRun(
      gateRun([result("typecheck", "block", { status: "pass" })], {
        receiptsWritten: ["typecheck"],
        receiptErrors: [{ checkId: "test", detail: "EROFS" }],
      }),
    );

    expect(text).toContain("typecheck");
    expect(text).toMatch(/receipt/i);
    expect(text).toContain("EROFS");
  });

  it("renders identically for identical input — the report is diffable", () => {
    const results = [
      result("typecheck", "block", { status: "pass" }),
      result("correctness", "warn", { status: "fail", detail: "hmm" }),
    ];
    expect(renderGateRun(gateRun(results))).toBe(renderGateRun(gateRun(results)));
  });
});

/**
 * The exit code is a CI signal, not the verdict. Keeping them separate is what lets
 * rule 1 hold while still refusing to pretend an unrun gate verified anything:
 * `verdict` stays `pass` and `blocking` stays empty, and the incompleteness is
 * reported through a DIFFERENT channel with a different number.
 */
describe("exitCodeFor", () => {
  const ERRORED: CheckOutcome = { status: "errored", detail: "budget exhausted" };

  it("is 0 on a clean pass, and on a run with no checks at all", () => {
    expect(exitCodeFor(aggregate([result("test", "block", { status: "pass" })]))).toBe(EXIT_PASS);
    expect(exitCodeFor(aggregate([]))).toBe(EXIT_PASS);
  });

  it("is 1 when — and only when — a real check failure blocked", () => {
    expect(exitCodeFor(aggregate([result("test", "block", { status: "fail", detail: "x" })]))).toBe(
      EXIT_BLOCKED,
    );
  });

  it("is 2, not 1, when a check that COULD have blocked never ran", () => {
    // Distinct from a block on purpose. Reusing exit 1 would tell CI "this change is
    // bad" when the truth is "we do not know" — exactly the conflation rule 1 bans.
    // Reusing exit 0 would let a permanently broken judge silently disable the gate,
    // which is the failure the constitution calls worse than having no gate.
    expect(exitCodeFor(aggregate([result("test", "block", ERRORED)]))).toBe(EXIT_INCOMPLETE);
  });

  it("is 0 when only an ADVISORY check errored — no gating power was lost", () => {
    // A `warn` lens that times out costs you an annotation, not a verification.
    // Failing CI for it is how a gate gets routed around.
    expect(exitCodeFor(aggregate([result("correctness", "warn", ERRORED)]))).toBe(EXIT_PASS);
    expect(exitCodeFor(aggregate([result("style", "annotate", ERRORED)]))).toBe(EXIT_PASS);
  });

  it("prefers the block code when a real failure and an error happen together", () => {
    expect(
      exitCodeFor(
        aggregate([result("test", "block", { status: "fail", detail: "x" }), result("c", "block", ERRORED)]),
      ),
    ).toBe(EXIT_BLOCKED);
  });

  it("is 0 for a skip — a receipt is proof the check already passed", () => {
    expect(
      exitCodeFor(aggregate([result("test", "block", { status: "skipped", reason: "receipt" })])),
    ).toBe(EXIT_PASS);
  });
});
