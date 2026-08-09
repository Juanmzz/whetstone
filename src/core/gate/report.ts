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
 * The exit code is a CI SIGNAL, not the verdict — which is why it can distinguish
 * cases the verdict deliberately cannot.
 *
 * `EXIT_INCOMPLETE` fires only when a check whose severity is `block` errored. An
 * errored `warn`/`annotate` lens cost you an annotation, not a verification, and
 * failing CI over a flaky advisory model is precisely how a gate gets routed around.
 */
export function exitCodeFor(verdict: GateVerdict): number {
  if (verdict.verdict === "block") return EXIT_BLOCKED;

  const lostGating = verdict.results.some(
    (r) => r.outcome.status === "errored" && r.severity === "block",
  );
  return lostGating ? EXIT_INCOMPLETE : EXIT_PASS;
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

  if (verdict.blocking.length > 0) {
    lines.push(`  BLOCKED — ${verdict.blocking.length} check(s) failed:`);
    for (const result of verdict.results) {
      if (result.outcome.status === "fail" && verdict.blocking.includes(result.checkId)) {
        lines.push(`    ${result.checkId}`, indent(result.outcome.detail));
      }
    }
  } else if (verdict.results.length === 0) {
    // Do NOT say "verified". Nothing was.
    lines.push("  passed — but no check applied, so nothing about this change was verified");
  } else {
    lines.push("  passed");
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
