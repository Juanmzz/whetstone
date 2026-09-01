/**
 * The answer `wst ready` gives, and the number underneath it. PURE.
 *
 * Two vocabularies on purpose. A person and a JSON consumer get a semantic result;
 * a shell gets an exit code. The number is protocol, and it has never been product
 * language: `exit 2` tells a reader nothing about what to do next.
 */

import type { GateOutcome } from "../gate/report.js";

export type Readiness = "READY" | "NOT_READY" | "INCOMPLETE" | "NO_CHANGES";

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;
export const EXIT_INCOMPLETE = 2;

/**
 * `hadChanges` is separate from the outcome because the gate cannot tell the two
 * apart: an empty diff and a diff nothing matched both reach it as "no results".
 */
export function readinessOf(outcome: GateOutcome, hadChanges: boolean): Readiness {
  if (!hadChanges) return "NO_CHANGES";
  switch (outcome) {
    case "blocked":
      return "NOT_READY";
    case "passed":
      return "READY";
    // `uncovered` exits 0 in the gate (adr-0021), where the question is whether a
    // push may proceed. Here the question is whether the work is ready, and a run
    // that verified nothing has not established that.
    case "uncovered":
    case "incomplete":
      return "INCOMPLETE";
  }
}

export function exitFor(readiness: Readiness): number {
  switch (readiness) {
    case "NOT_READY":
      return EXIT_NOT_READY;
    case "INCOMPLETE":
      return EXIT_INCOMPLETE;
    // No edit makes an empty change verifiable, so a non-zero code here is one
    // nobody can satisfy. The semantic field is what keeps it from reading as ready.
    case "NO_CHANGES":
    case "READY":
      return EXIT_READY;
  }
}

const SAID: Readonly<Record<Readiness, string>> = {
  READY: "Ready",
  NOT_READY: "Needs work",
  INCOMPLETE: "Verification incomplete",
  NO_CHANGES: "No changes to verify",
};

/** The line a person reads. Never a number, and never "passed" for NO_CHANGES. */
export const saidAs = (readiness: Readiness): string => SAID[readiness];
