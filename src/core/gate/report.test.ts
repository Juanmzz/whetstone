import { describe, expect, it } from "vitest";
import type { CheckOutcome, CheckResult } from "../contracts.js";
import { aggregate } from "./aggregate.js";
import {
  EXIT_BLOCKED,
  EXIT_INCOMPLETE,
  EXIT_PASS,
  exitCodeFor,
  outcomeOf,
  type Coverage,
  renderGateRun,
} from "./report.js";
import type { GateRun } from "./run.js";
import type { Selection } from "./select.js";

const coverage = (over: Partial<Coverage> = {}): Coverage => ({ declined: [], ...over });

const EMPTY_SELECTION: Selection = { selected: [], excluded: [], unknown: [], unmatched: [], declined: [] };

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

  it("does not headline a run as passed when a blocking check never ran", () => {
    // This file's own header names THREE outcomes and says they are kept apart on
    // purpose: blocked, incomplete, and passed. The render had two — a blocking
    // check that errored produced the headline `passed`, and the fact that nothing
    // had verified it arrived several lines later as a footnote.
    //
    // The exit code was already right (2). That is what makes this worth fixing
    // rather than shrugging at: a human reads the word, a script reads the code,
    // and they were being told different things about the same run.
    const text = renderGateRun(
      gateRun([
        result("typecheck", "block", { status: "pass" }),
        result("test", "block", { status: "errored", detail: "spawn ENOENT" }),
      ]),
    );

    expect(text).toMatch(/INCOMPLETE/);
    expect(text).not.toMatch(/^\s*passed\s*$/m);
    expect(text).not.toMatch(/BLOCKED/);
  });

  it("does not headline a pass when every check was skipped for not applying", () => {
    // The residual half, and the one that bites in practice. `--no-lens` renders
    // every lens as `skipped: disabled`, and that is what the pre-push hook runs.
    // In a registry that is lens-only, the whole run is non-receipt skips: the
    // exit code said 2 and the headline said `passed`, which is the same
    // divergence the INCOMPLETE case above was added to kill — left alive because
    // only half of the decision was shared.
    const text = renderGateRun(
      gateRun([result("correctness", "warn", { status: "skipped", reason: "disabled" })]),
    );

    expect(text).toMatch(/INCOMPLETE|nothing about this change was verified/);
    expect(text).not.toMatch(/^\s*passed\s*$/m);
  });

  it("still headlines a pass when a blocking check was skipped by a RECEIPT", () => {
    // The control. A receipt skip means this exact input passed already, and
    // collapsing it into "nothing was verified" would make the cache look like a
    // hole — the same distinction `exitCodeFor` has always drawn.
    const text = renderGateRun(
      gateRun([result("test", "block", { status: "skipped", reason: "receipt" })]),
    );

    expect(text).toMatch(/passed/);
    expect(text).not.toMatch(/INCOMPLETE/);
  });

  it("still headlines a pass when only an ADVISORY check could not run", () => {
    // The other side of the same line, and the reason this is not "any error means
    // incomplete". An errored `warn` lens cost an annotation, not a verification —
    // exactly the reasoning `exitCodeFor` already applies to the exit code. Failing
    // the headline over a flaky advisory model is how a gate gets routed around.
    const text = renderGateRun(
      gateRun([
        result("typecheck", "block", { status: "pass" }),
        result("correctness", "warn", { status: "errored", detail: "budget exhausted" }),
      ]),
    );

    expect(text).toMatch(/passed/);
    expect(text).not.toMatch(/INCOMPLETE/);
  });

  it("says pass when nothing blocked", () => {
    const text = renderGateRun(gateRun([result("typecheck", "block", { status: "pass" })]));
    expect(text).toMatch(/passed/i);
    expect(text).not.toMatch(/BLOCKED/);
  });

  it("labels warnings as advisory and does NOT present them as blockers", () => {
    // This used to also assert the headline said `passed`, and that assertion was
    // pinning a divergence: with an advisory failure as the only result, nothing
    // passed and no receipt covered anything, so `exitCodeFor` already returned 2.
    // The render said `passed` over an exit code of 2 — the same bug as the
    // `--no-lens` case, in a third place. What the test is actually about is that
    // an advisory finding is never dressed up as a block, and that still holds.
    const text = renderGateRun(
      gateRun([result("correctness", "warn", { status: "fail", detail: "maybe an off-by-one" })]),
    );

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
 *
 * FOUND BY A CREWMATE, not by a test. Dispatched with "run the checks yourself", it
 * ran `wst gate --no-lens --no-emit`, got the default `--range HEAD` against a clean
 * tree, and was told:
 *
 *   no checks applied to this change
 *   passed — but no check applied, so nothing about this change was verified
 *   $? = 0
 *
 * The prose was honest and the exit code was not, and an agent, a git hook and a CI
 * step all read the number. This file's own header promises that "no checks applied"
 * is "reported as itself rather than dressed up as a pass" — it was, in the render
 * only, one layer above the thing anyone actually consumes.
 *
 * A receipt skip DOES count as verified: it means this exact input passed already.
 * "Nothing matched" and "nothing needed re-running" are different facts.
 */
describe("a run that verified nothing says so, and no longer blocks", () => {
  /**
   * Reversed by adr-0021. Both cases used to exit 2, which a hook reads as a
   * required check failing to run — so a change nothing was going to verify was
   * refused, and no edit could make it pass. Measured four times in two days:
   * a markdown-only commit, a message amend, a tag push, twice answered with
   * --no-verify.
   *
   * The prose contract is unchanged and is what carries the honesty: the run
   * still says nothing about this change was verified.
   */
  it("is UNCOVERED when no check applied at all", () => {
    expect(exitCodeFor(aggregate([]), coverage())).toBe(EXIT_PASS);
  });

  it("is UNCOVERED when every check was skipped for not applying", () => {
    const skipped = [
      result("test", "block", { status: "skipped", reason: "not-in-tier" }),
      result("lint", "warn", { status: "skipped", reason: "not-in-tier" }),
    ];
    expect(exitCodeFor(aggregate(skipped), coverage())).toBe(EXIT_PASS);
  });

  it("PASSES when every check was skipped by a RECEIPT — that input did pass", () => {
    const cached = [
      result("test", "block", { status: "skipped", reason: "receipt" }),
      result("typecheck", "block", { status: "skipped", reason: "receipt" }),
    ];
    expect(exitCodeFor(aggregate(cached), coverage())).toBe(EXIT_PASS);
  });

  it("PASSES when at least one check actually ran and passed", () => {
    const mixed = [
      result("test", "block", { status: "pass" }),
      result("lint", "warn", { status: "skipped", reason: "not-in-tier" }),
    ];
    expect(exitCodeFor(aggregate(mixed), coverage())).toBe(EXIT_PASS);
  });

  it("still reports BLOCKED ahead of incomplete when something failed", () => {
    // A real failure is the more urgent fact, and 1 is what a hook keys on.
    const failed = [result("test", "block", { status: "fail", detail: "nope" })];
    expect(exitCodeFor(aggregate(failed), coverage())).toBe(EXIT_BLOCKED);
  });
});

describe("exitCodeFor", () => {
  const ERRORED: CheckOutcome = { status: "errored", detail: "budget exhausted" };

  it("is 0 on a clean pass", () => {
    expect(exitCodeFor(aggregate([result("test", "block", { status: "pass" })]), coverage())).toBe(EXIT_PASS);
    // The "no checks at all" case used to assert 0 here. See the describe above:
    // that was the bug, and a run that verified nothing is now INCOMPLETE.
  });

  it("is 1 when — and only when — a real check failure blocked", () => {
    expect(exitCodeFor(aggregate([result("test", "block", { status: "fail", detail: "x" })]), coverage())).toBe(
      EXIT_BLOCKED,
    );
  });

  it("is 2, not 1, when a check that COULD have blocked never ran", () => {
    // Distinct from a block on purpose. Reusing exit 1 would tell CI "this change is
    // bad" when the truth is "we do not know" — exactly the conflation rule 1 bans.
    // Reusing exit 0 would let a permanently broken judge silently disable the gate,
    // which is the failure the constitution calls worse than having no gate.
    expect(exitCodeFor(aggregate([result("test", "block", ERRORED)]), coverage())).toBe(EXIT_INCOMPLETE);
  });

  it("is 0 when an ADVISORY check errored beside work that DID get verified", () => {
    // A `warn` lens that times out costs you an annotation, not a verification.
    // Failing CI for it is how a gate gets routed around.
    const withPass = (advisory: CheckResult) =>
      exitCodeFor(aggregate([result("test", "block", { status: "pass" }), advisory]), coverage());
    expect(withPass(result("correctness", "warn", ERRORED))).toBe(EXIT_PASS);
    expect(withPass(result("style", "annotate", ERRORED))).toBe(EXIT_PASS);
  });

  /**
   * TWO REAL RULES MEET HERE, and the resolution is deliberate.
   *
   * "An errored advisory must not fail CI" is right, and this test used to encode it
   * with a fixture holding NOTHING BUT the errored advisory — so it also asserted 0
   * for a run in which nothing whatsoever was verified.
   *
   * Those are separable. The rule protects a verified run from a flaky model; it was
   * never meant to bless a run with no verification in it. `INCOMPLETE` is not
   * `BLOCKED`: it says "we do not know", which is exactly the truth here, and every
   * ambiguity in this engine resolves toward more verification, not less.
   */
  it("is INCOMPLETE when the errored advisory was the ONLY thing that ran", () => {
    expect(exitCodeFor(aggregate([result("correctness", "warn", ERRORED)]), coverage())).toBe(EXIT_INCOMPLETE);
  });

  it("prefers the block code when a real failure and an error happen together", () => {
    expect(
      exitCodeFor(
        aggregate([result("test", "block", { status: "fail", detail: "x" }), result("c", "block", ERRORED)]),
        coverage(),
      ),
    ).toBe(EXIT_BLOCKED);
  });

  it("is 0 for a skip — a receipt is proof the check already passed", () => {
    expect(
      exitCodeFor(
        aggregate([result("test", "block", { status: "skipped", reason: "receipt" })]),
        coverage(),
      ),
    ).toBe(EXIT_PASS);
  });
});

/**
 * adr-0021: "nothing covers this" is not "the gate broke".
 *
 * They shared `incomplete` and therefore exit 2, so a hook blocked both. Hard
 * rule 3 enumerates what counts as could-not-run — spawn, budget, timeout, auth,
 * invalid output — and "no check matched these paths" is not on that list.
 *
 * The cost of the conflation, measured four times in two days: a markdown-only
 * change, a commit-message amend and a tag push were each refused by a gate that
 * was never going to verify them, and twice the author reached for --no-verify.
 */
describe("outcomeOf — uncovered is its own outcome", () => {
  it("names it uncovered when nothing matched, not incomplete", () => {
    expect(outcomeOf(aggregate([]), coverage())).toBe("uncovered");
  });

  it("stays incomplete when a blocking check could not RUN", () => {
    const errored = [result("test", "block", { status: "errored", detail: "spawn" })];

    expect(outcomeOf(aggregate(errored), coverage())).toBe("incomplete");
    expect(exitCodeFor(aggregate(errored), coverage())).toBe(EXIT_INCOMPLETE);
  });

  it("is NOT uncovered when a check that covers these paths was switched off", () => {
    // The distinction adr-0021 rests on: `uncovered` exits 0 because no edit could
    // make it pass, so blocking would only teach `--no-verify`. A check that WOULD
    // have matched and was disabled has a remedy — re-enable it — so it is the gate
    // being declined, not the change being uncoverable.
    //
    // This was unreachable before. `route()` drops disabled checks before selection
    // ever runs, so they produced no result, and "no results" fell through to
    // `uncovered` and exit 0. Deleting the guard that was meant to catch it left
    // `src/core/gate/**` fully green.
    const verdict = aggregate([]);

    expect(outcomeOf(verdict, coverage({ declined: ["typecheck"] }))).toBe("incomplete");
    expect(exitCodeFor(verdict, coverage({ declined: ["typecheck"] }))).toBe(EXIT_INCOMPLETE);
  });

  it("ignores a disabled check that would not have matched these paths anyway", () => {
    // Only coverage that APPLIED counts as declined. A retired check for another
    // corner of the repo must not make every unrelated run incomplete.
    expect(outcomeOf(aggregate([]), coverage({ declined: [] }))).toBe("uncovered");
  });
});

/**
 * adr-0018: a method is DECLARED, never verified.
 *
 * It is prose an agent follows — drive the browser, take the screenshots — so the
 * gate cannot produce a verdict on it. Two things follow, and the second is the
 * one hard rule 3 cares about: a run whose only applicable check was a method has
 * verified nothing, and must not headline a pass.
 */
describe("a method check in a run", () => {
  const declared = [result("ui-states", "annotate", { status: "declared" })];

  it("does not count as something verified", () => {
    expect(outcomeOf(aggregate(declared))).toBe("uncovered");
  });

  it("does not block, whatever else happened", () => {
    expect(exitCodeFor(aggregate(declared))).toBe(EXIT_PASS);
  });

  it("is named in the run, because an unmentioned method is one nobody will run", () => {
    const text = renderGateRun(gateRun(declared));

    expect(text).toContain("ui-states");
    expect(text).toMatch(/declared/i);
  });

  it("does not let a passing check make the method read as verified", () => {
    const mixed = [...declared, result("typecheck", "block", { status: "pass" })];
    const text = renderGateRun(gateRun(mixed));

    // The run passed — typecheck ran. The method still did not.
    expect(outcomeOf(aggregate(mixed))).toBe("passed");
    expect(text).toMatch(/declared/i);
  });
});
