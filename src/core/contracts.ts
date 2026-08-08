/**
 * Shared domain types for the gate pipeline. SHARED CONTRACT — owned by the
 * orchestrator, not by any lane.
 *
 * This file exists because of what Step 1 taught: the check schema had to be fixed
 * BEFORE triage and receipts could be built in parallel, or each lane would have
 * invented it and collided in the one place that hurts most. Triage and the gate
 * have the same relationship, so the seam between them is written down first.
 *
 * The pipeline these describe:
 *   git diff -> ChangedFile[] -> classify() -> TriageResult
 *                                           -> route() -> Routing
 *                                           -> select checks -> receipts skip?
 *                                           -> run -> CheckResult[] -> aggregate() -> GateVerdict
 */

import type { ChangedFile } from "./diff/parse.js";
import type { Check, Tier } from "./checks/schema.js";

// ── Layer 2: triage + routing ────────────────────────────────────────────────

export interface TriageRule {
  /** Glob matched against changed paths, via node:path matchesGlob. */
  readonly glob: string;
  readonly tier: Tier;
  /** MANDATORY. A rule that cannot say why it exists cannot be reviewed. */
  readonly reason: string;
}

export interface TriageResult {
  /** The MAXIMUM tier across all touched files. Size only escalates, never de-escalates. */
  readonly tier: Tier;
  /** Which rule won, per file — first-match-wins, so this is auditable. */
  readonly matches: readonly {
    readonly file: ChangedFile;
    readonly tier: Tier;
    readonly reason: string;
  }[];
  /** One line explaining the overall tier, for the gate to print. */
  readonly reason: string;
}

export type Autonomy = "human-gate" | "autonomous";

export interface Routing {
  readonly tier: Tier;
  /** Ids of the checks that apply at this tier. */
  readonly checks: readonly string[];
  /** Critical work keeps a human in the loop; trivial work does not. */
  readonly autonomy: Autonomy;
  readonly modelTier: "haiku" | "sonnet" | "opus";
  /** Whether a failing check may be auto-fixed, or must escalate. */
  readonly autofix: boolean;
}

// ── Layer 4: the gate ────────────────────────────────────────────────────────

/**
 * Why a check produced no verdict. Kept SEPARATE from a failing verdict on purpose:
 * only a real check failure may block. A check that could not run is the GATE being
 * broken, and reporting the two as one number hides which problem you have.
 */
export type CheckOutcome =
  | { readonly status: "pass" }
  | { readonly status: "fail"; readonly detail: string }
  | { readonly status: "skipped"; readonly reason: "receipt" | "not-in-tier" | "disabled" }
  | { readonly status: "errored"; readonly detail: string };

export interface CheckResult {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly severity: Check["severity"];
  readonly outcome: CheckOutcome;
  readonly durationMs: number;
  /** Only set for agent-lens checks. Deterministic checks are free. */
  readonly costUsd?: number;
}

export interface GateVerdict {
  readonly verdict: "pass" | "block";
  /** Check ids that failed AND were allowed to block. */
  readonly blocking: readonly string[];
  /** Failed but capped at warn/annotate — reported, never blocking. */
  readonly warnings: readonly string[];
  /** Checks that never ran. NOT failures: infrastructure, reported separately. */
  readonly errored: readonly string[];
  readonly skipped: readonly string[];
  readonly results: readonly CheckResult[];
  readonly totalCostUsd: number;
}
