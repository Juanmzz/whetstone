/**
 * The verdict. PURE, total, and the most safety-critical function in Whetstone:
 * every gated change in every project that runs it passes through here.
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

      case "declared":
        // A method (adr-0018) is prose for an agent to follow, not a verdict. It
        // belongs in no bucket: it cannot block, warn, error, or be skipped. That
        // was already true by omission — this states it, and the `never` below
        // makes the next outcome anyone adds decide what it means here.
        break;

      default: {
        const unhandled: never = result.outcome;
        throw new Error(
          `unhandled check outcome ${JSON.stringify(unhandled)} — a new outcome must ` +
            `say what it means for the verdict rather than falling through it`,
        );
      }
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
