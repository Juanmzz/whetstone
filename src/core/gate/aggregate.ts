/**
 * The verdict. PURE, total, and the most safety-critical function in Whetstone:
 * every gated change in every project that runs it passes through here.
 *
 * It is deliberately a fold over `CheckResult[]` with no I/O, no ports and no
 * configuration. Everything that could make the decision situational — which checks
 * ran, what they cost, whether a receipt let one be skipped — has already happened
 * upstream. What is left is one question per result, answered the same way every
 * time.
 *
 * The five invariants, which the tests are written to break:
 *
 *   1. Only a real check FAILURE may block. `errored` is the gate being broken —
 *      spawn failure, budget, timeout, auth, unusable LLM output — not a judgement
 *      about the change. It surfaces in `errored`, never in `blocking`.
 *   2. Severity is obeyed ABSOLUTELY. A `warn` or `annotate` check that fails goes
 *      in `warnings` no matter how badly it failed. `correctness` sits at `warn`
 *      because it false-positives on ~20% of correct code; a cap that a bad enough
 *      failure could escape is not a cap.
 *   3. Receipts are written on pass only (enforced upstream by `recordPass` — this
 *      function never writes anything).
 *   4. A skipped check is NOT a passed check. It is reported in `skipped` with its
 *      reason.
 *   5. `verdict === "block"` if and only if `blocking.length > 0`.
 *
 * Invariant 5 is why `verdict` is DERIVED from `blocking` rather than computed
 * alongside it: there is no code path that can set one without the other.
 */

import type { CheckResult, GateVerdict } from "../contracts.js";

export function aggregate(results: readonly CheckResult[]): GateVerdict {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const errored: string[] = [];
  const skipped: string[] = [];
  let totalCostUsd = 0;

  const seen = new Set<string>();

  for (const result of results) {
    // Two results for one check means the caller is confused about what ran.
    // Producing a verdict anyway would silently pick one of them, and a gate that
    // is quietly wrong is worse than one that stops, because it is trusted.
    if (seen.has(result.checkId)) {
      throw new Error(
        `duplicate result for check "${result.checkId}" — a check produces exactly one ` +
          `result per gate run, and aggregating two would make the verdict depend on order`,
      );
    }
    seen.add(result.checkId);

    totalCostUsd += result.costUsd ?? 0;

    switch (result.outcome.status) {
      case "pass":
        break;

      case "fail":
        // THE ONE PLACE `blocking` IS APPENDED TO, and it is guarded by severity.
        // Note what is NOT consulted: the failure detail, the check's kind, how many
        // files it matched, or anything the check itself said about its own gravity.
        if (result.severity === "block") blocking.push(result.checkId);
        else warnings.push(result.checkId);
        break;

      case "errored":
        // Severity is not consulted here AT ALL. A check that could not run has
        // produced no judgement, so there is nothing for its severity to weight.
        errored.push(result.checkId);
        break;

      case "skipped":
        skipped.push(result.checkId);
        break;
    }
  }

  return {
    verdict: blocking.length > 0 ? "block" : "pass",
    blocking,
    warnings,
    errored,
    skipped,
    results,
    totalCostUsd,
  };
}
