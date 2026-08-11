/**
 * A signal a HUMAN recorded, built and validated. PURE.
 *
 * Why this exists. Every one of the 45 entries in this repo's log was typed by an
 * agent into a file, because that was the only route: no command, no validation,
 * just JSON and a steady hand. The engine emits its own signals now, and the human
 * — who notices the things a gate cannot express and whose observation is the best
 * evidence the log ever gets — still had the worst tool of anyone.
 *
 * The write is legitimate because the human TYPED IT. That is [RC3]'s gate
 * discharged in the most direct form it has: not an agent proposing and a human
 * confirming, but the human authoring. Nothing else in the system inherits that
 * right from this file — an agent that thinks it has a signal still proposes.
 *
 * Validation is here rather than in the command because it is deterministic and it
 * is where the damage is done: `type` and `severity` are what the retro clusters
 * and ranks on, so a typo in either one is not a cosmetic problem, it is a signal
 * that quietly never joins the group it belongs to.
 */

import { signalId, type SignalSeverity } from "./emit.js";
import type { SignalRecord } from "./parse.js";

export interface HumanObservation {
  readonly type: string;
  readonly phase: string;
  /** Unvalidated as it arrives from a CLI; checked against the scale below. */
  readonly severity: string;
  readonly detail: string;
  readonly ruleAffected?: readonly string[];
  /** From the git adapter. `null` on a detached HEAD. */
  readonly branch: string | null;
}

export type HumanSignalResult =
  | { readonly ok: true; readonly record: SignalRecord }
  | { readonly ok: false; readonly errors: readonly string[] };

const SEVERITIES: readonly string[] = ["low", "medium", "high"];

/**
 * Open vocabulary, kebab-case (SPEC §2.1). Enforced because `clusterSignals`
 * buckets on `type:<name>` verbatim: `Triage Miss` and `triage-miss` become two
 * clusters over one problem, and a cluster of one is never actionable.
 */
const TYPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every problem at once. A human recording an observation is mid-thought and
 * mid-task; three round trips to learn three things is how a command stops being
 * used, and an unused recording command returns us to a hand-written log.
 */
export function humanSignal(input: HumanObservation, now: Date): HumanSignalResult {
  const type = input.type.trim();
  const phase = input.phase.trim();
  const detail = input.detail.trim();
  const errors: string[] = [];

  if (!TYPE.test(type)) {
    errors.push(
      `type "${input.type}" is not kebab-case (e.g. \`triage-miss\`) — the retro clusters on it verbatim`,
    );
  }
  if (phase === "") {
    errors.push("phase is empty — say where it happened (init, plan, apply, verify, review, …)");
  }
  if (!SEVERITIES.includes(input.severity)) {
    errors.push(`severity "${input.severity}" is not one of ${SEVERITIES.join("/")}`);
  }
  if (detail === "") {
    errors.push("detail is empty — a signal nobody can reconstruct the event from is not evidence");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    record: {
      // Seeded with the timestamp as well as the content, so recording the same
      // observation twice on purpose gives two entries. Recurrence is what the
      // retro reasons over, and a human logging it again is asserting exactly that.
      id: signalId(`human:${now.toISOString()}:${type}:${detail}`),
      ts: now.toISOString(),
      type,
      phase,
      severity: input.severity as SignalSeverity,
      detail,
      ...(input.branch !== null ? { branch: input.branch } : {}),
      rule_affected: [...(input.ruleAffected ?? [])],
      // NOT `gate`, and not absent either. Absent is what the agent-written
      // entries look like, and blending a human's observation into those is
      // losing the only provenance distinction the log has.
      source: "human",
    },
  };
}
