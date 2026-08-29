/**
 * Whether a check can be answered WHERE the gate is running. PURE.
 *
 * A caller's assertion about the machine, not a fact the registry holds: the
 * registry says which PATHS a check covers and never where it can answer
 * (adr-0038).
 */

import type { LoadedCheck } from "../checks/registry.js";

export const EVIDENCE_PREFIX = "evidence-";

export interface Environment {
  readonly noEvidence?: boolean;
}

export function answerableHere(check: LoadedCheck, environment: Environment): boolean {
  return !(environment.noEvidence === true && check.id.startsWith(EVIDENCE_PREFIX));
}
