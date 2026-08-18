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

export type GateOutcome =
  /** A check failed. The only outcome that is a verdict on the change. */
  | "blocked"
  /** A blocking check could not RUN. The gate is broken, not the change. */
  | "incomplete"
  /**
   * No check matched these paths. Nothing broke and nothing was attempted.
   *
   * adr-0021. It shared `incomplete` and therefore exit 2, so a hook refused a
   * change no edit could make pass — a markdown-only commit, a message amend, a
   * tag. That is the pressure that teaches `--no-verify`, and a routed-around
   * gate stops catching the real findings too.
   */
  | "uncovered"
  /** Something ran, or a receipt proved it already had. */
  | "passed";

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
export interface Coverage {
  /**
   * Checks that would have matched these paths and are switched off.
   *
   * Comes from `Selection`, which reads the registry rather than the routing
   * table. It cannot be derived from the results: a disabled check produces no
   * result at all, which is exactly how it used to be indistinguishable from
   * genuine absence of coverage.
   */
  readonly declined: readonly string[];
}

export function outcomeOf(verdict: GateVerdict, coverage: Coverage): GateOutcome {
  if (verdict.verdict === "block") return "blocked";
  if (lostGating(verdict)) return "incomplete";
  if (verifiedSomething(verdict)) return "passed";

  // Everything below is "nothing was verified". `uncovered` is the narrow case
  // where that is nobody's doing and nothing can be done about it — and it is
  // narrow, because it exits 0. Every way of arriving here that HAS a remedy has
  // to be named above it, or the remedy never gets applied.
  //
  // An errored check of ANY severity tried and broke — the gate, not the
  // coverage, even when the check was only advisory.
  if (verdict.results.some((r) => r.outcome.status === "errored")) return "incomplete";
  // A check switched off means the change HAD coverage and someone declined it.
  // Two ways in, and they arrive differently: `--no-lens` produces a `skipped`
  // RESULT, while `enabled: false` is dropped by `route()` before selection and
  // produces nothing at all. The second was unreachable through the results, so
  // it fell to `uncovered` and exit 0 — a change nobody looked at, reported as
  // fine. `coverage.declined` is how the second one gets here.
  if (verdict.results.some((r) => r.outcome.status === "skipped" && r.outcome.reason === "disabled"))
    return "incomplete";
  if (coverage.declined.length > 0) return "incomplete";
  return "uncovered";
}

/** The exit code is a CI SIGNAL, not the verdict — it is `outcomeOf`, as a number. */
export function exitCodeFor(verdict: GateVerdict, coverage: Coverage): number {
  switch (outcomeOf(verdict, coverage)) {
    case "blocked":
      return EXIT_BLOCKED;
    case "incomplete":
      return EXIT_INCOMPLETE;
    // Exit 0, and the message says nothing was verified. There is no action
    // behind a block here, and a block nobody can satisfy is how a gate gets
    // disarmed (adr-0021).
    case "uncovered":
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
    case "declared":
      // Its own word, never `pass` and never `skipped`. The gate did not run it
      // and never could; whoever does the work does (adr-0018).
      return `  declared ${id} — a method, for you to run. Not verified here`;
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

  switch (outcomeOf(verdict, selection)) {
    case "blocked":
      lines.push(`  BLOCKED — ${verdict.blocking.length} check(s) failed:`);
      for (const result of verdict.results) {
        if (result.outcome.status === "fail" && verdict.blocking.includes(result.checkId)) {
          lines.push(`    ${result.checkId}`, indent(result.outcome.detail));
        }
      }
      break;
    case "incomplete":
      // Something tried to run and broke. Hard rule 3 forbids this sharing a
      // sentence with `passed`, and the exit code says the same (2).
      lines.push("  INCOMPLETE — a check never ran, so this change is unverified");
      break;
    case "uncovered":
      // Exits 0, so the WORDS are the whole of the honesty. It must never read
      // as a pass, and it must name what is missing rather than what failed:
      // there is no failure here and no edit that would fix one (adr-0021).
      lines.push("  UNCOVERED — no check applied, so nothing about this change was verified");
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
