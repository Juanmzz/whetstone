/**
 * Shared domain types for the gate pipeline. SHARED CONTRACT — owned by the
 * orchestrator, not by any lane.
 */

import type { ChangedFile } from "./diff/parse.js";
import type { Check, Tier } from "./checks/schema.js";
import type { ModelTier } from "./ports.js";

// ── Layer 2: triage + routing ────────────────────────────────────────────────

export interface TriageRule {
  /** Glob matched against changed paths, via node:path matchesGlob. */
  readonly glob: string;
  readonly tier: Tier;
  /** MANDATORY. A rule that cannot say why it exists cannot be reviewed. */
  readonly reason: string;
}

/** Which rule won for one file. Named so triage and the gate cannot invent two names. */
export interface TriageMatch {
  readonly file: ChangedFile;
  readonly tier: Tier;
  readonly reason: string;
}

export interface TriageResult {
  /** The MAXIMUM tier across all touched files. Size only escalates, never de-escalates. */
  readonly tier: Tier;
  /** Which rule won, per file — first-match-wins, so this is auditable. */
  readonly matches: readonly TriageMatch[];
  /**
   * Where the rules came from: `.wst/triage.yaml`, or the built-in defaults. A receipt
   * has to be re-checkable, and "which rules were in force" is part of that.
   */
  readonly rulesSource: string;
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
  readonly modelTier: ModelTier;
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
  | { readonly status: "errored"; readonly detail: string }
  /**
   * A `method` check applied and was NOT run (adr-0018). It is prose an agent
   * follows, so the gate has no verdict to give — it reports that the method was
   * declared and leaves the doing to whoever does the work.
   *
   * Deliberately not `skipped`: a skip means something could have run and did
   * not. Nothing here was ever going to run, and collapsing the two would let a
   * run with only methods read as one that chose to skip its checks.
   */
  | { readonly status: "declared" };

export interface CheckResult {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly severity: Check["severity"];
  readonly outcome: CheckOutcome;
  readonly durationMs: number;
  /** Only set for llm checks. Deterministic checks are free. */
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
