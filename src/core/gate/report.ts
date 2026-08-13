/**
 * Rendering the gate run, and turning it into an exit code. PURE.
 *
 * This is not cosmetics. The gate's whole value rests on a human trusting what it
 * says, so the report has one job beyond listing outcomes: never let a reader
 * conclude "verified" from something that was not. Three states get separate words
 * on purpose —
 *
 *   blocked     a check ran and said no
 *   incomplete  a check that could have blocked never ran — we do not know
 *   passed      everything that applied actually ran and agreed
 *
 * and "no checks applied" is reported as itself rather than dressed up as a pass.
 */

import type { CheckResult, GateVerdict } from "../contracts.js";
import type { GateRun } from "./run.js";

export const EXIT_PASS = 0;
export const EXIT_BLOCKED = 1;
/** The gate could not complete: a check that may block never ran. */
export const EXIT_INCOMPLETE = 2;

/**
 * A check that COULD have blocked did not run, so nothing it covers was verified.
 *
 * An errored `warn`/`annotate` lens is deliberately NOT this — it cost an
 * annotation, not a verification, and failing over a flaky advisory model is
 * precisely how a gate gets routed around.
 */
function lostGating(verdict: GateVerdict): boolean {
  return verdict.results.some((r) => r.outcome.status === "errored" && r.severity === "block");
}

/**
 * Something actually stood behind this change.
 *
 * A receipt skip counts: it means this exact input passed already. "Nothing matched"
 * and "nothing needed re-running" are different facts, and collapsing them would
 * make the cache look like a hole.
 */
function verifiedSomething(verdict: GateVerdict): boolean {
  return verdict.results.some(
    (r) =>
      r.outcome.status === "pass" ||
      (r.outcome.status === "skipped" && r.outcome.reason === "receipt"),
  );
}

export type GateOutcome = "blocked" | "incomplete" | "passed";

/**
 * The ONE decision, made once and consumed by both the number and the prose.
 *
 * The three outcomes are named at the top of this file, and they used to be derived
 * TWICE: `exitCodeFor` computed all three, and the renderer computed a different
 * two. A crewmate told "run the checks yourself" read "nothing about this change was
 * verified" and got `0` back — that was the first half. The second survived a fix
 * that shared only `lostGating`: a run where every check was skipped without a
 * receipt exited 2 under the headline `passed`, and that is precisely what
 * `--no-lens` produces in a lens-only registry — the mode the pre-push hook runs.
 *
 * Sharing half a predicate is how a rule implemented twice survives being fixed.
 */
export function outcomeOf(verdict: GateVerdict): GateOutcome {
  if (verdict.verdict === "block") return "blocked";
  if (lostGating(verdict)) return "incomplete";
  return verifiedSomething(verdict) ? "passed" : "incomplete";
}

/** The exit code is a CI SIGNAL, not the verdict — it is `outcomeOf`, as a number. */
export function exitCodeFor(verdict: GateVerdict): number {
  switch (outcomeOf(verdict)) {
    case "blocked":
      return EXIT_BLOCKED;
    case "incomplete":
      return EXIT_INCOMPLETE;
    case "passed":
      return EXIT_PASS;
  }
}

function indent(detail: string): string {
  return detail
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");
}

function statusLine(result: CheckResult): string {
  const id = result.checkId.padEnd(14);
  switch (result.outcome.status) {
    case "pass":
      return `  pass     ${id} (${result.durationMs}ms)`;
    case "fail":
      return `  ${result.severity === "block" ? "FAIL" : "warn"}     ${id} (${result.durationMs}ms)`;
    case "errored":
      return `  errored  ${id} — could not run`;
    case "skipped":
      return `  skipped  ${id} — ${result.outcome.reason}`;
  }
}

export function renderGateRun(run: GateRun): string {
  const { verdict, selection } = run;
  const lines: string[] = ["whetstone — gate", ""];

  for (const result of verdict.results) lines.push(statusLine(result));

  if (selection.unmatched.length > 0) {
    // Named, not counted. node's `matchesGlob` returns false for a malformed
    // pattern rather than throwing, so a typo in `include` looks exactly like a
    // check that legitimately did not apply. Printing the ids is what stops a
    // check silently ceasing to run.
    lines.push(`  n/a      matched no changed file: ${selection.unmatched.join(", ")}`);
  }

  if (verdict.results.length === 0) {
    lines.push("  no checks applied to this change");
  }

  lines.push("");

  switch (outcomeOf(verdict)) {
    case "blocked":
      lines.push(`  BLOCKED — ${verdict.blocking.length} check(s) failed:`);
      for (const result of verdict.results) {
        if (result.outcome.status === "fail" && verdict.blocking.includes(result.checkId)) {
          lines.push(`    ${result.checkId}`, indent(result.outcome.detail));
        }
      }
      break;
    case "incomplete":
      // One headline for the whole outcome, with the reason appended rather than
      // a different word per cause. "No check applied" and "a blocking check could
      // not run" are both `incomplete`, and hard rule 3 forbids either of them
      // sharing a sentence with `passed`.
      lines.push(
        verdict.results.length === 0
          ? "  INCOMPLETE — no check applied, so nothing about this change was verified"
          : "  INCOMPLETE — a check that can block never ran, so this change is unverified",
      );
      break;
    case "passed":
      lines.push("  passed");
      break;
  }

  if (verdict.warnings.length > 0) {
    lines.push("", `  warnings (advisory — these never block):`);
    for (const result of verdict.results) {
      if (result.outcome.status === "fail" && verdict.warnings.includes(result.checkId)) {
        lines.push(`    ${result.checkId}`, indent(result.outcome.detail));
      }
    }
  }

  if (verdict.errored.length > 0) {
    // The wording is load-bearing. These are NOT failures of the change, and a
    // reader who takes them as such will either panic or, worse, learn to ignore
    // the gate. They are also not successes: this change was not fully verified.
    lines.push(
      "",
      "  the gate could not run every check — this change was NOT fully verified:",
    );
    for (const result of verdict.results) {
      if (result.outcome.status === "errored") {
        lines.push(`    ${result.checkId} (severity: ${result.severity})`, indent(result.outcome.detail));
      }
    }
  }

  if (verdict.skipped.length > 0) {
    const reasons = verdict.results
      .filter((r) => r.outcome.status === "skipped")
      .map((r) => `${r.checkId} (${r.outcome.status === "skipped" ? r.outcome.reason : ""})`);
    lines.push("", `  skipped: ${reasons.join(", ")}`);
  }

  if (run.receiptsWritten.length > 0) {
    lines.push("", `  receipts written: ${run.receiptsWritten.join(", ")}`);
  }
  for (const error of run.receiptErrors) {
    lines.push(`  receipt for ${error.checkId} could not be written: ${error.detail}`);
  }

  if (verdict.totalCostUsd > 0) {
    lines.push("", `  cost: $${verdict.totalCostUsd.toFixed(4)}`);
  }

  return lines.join("\n");
}
