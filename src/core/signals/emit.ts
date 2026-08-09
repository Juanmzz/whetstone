/**
 * Signals emitted BY THE ENGINE, from what a gate run actually observed. PURE.
 *
 * Why this exists. Every signal in this repo's log up to now was hand-written by an
 * agent, and the retro then clustered over that log and produced rules stamped
 * "earned by evidence". The anti-poisoning gate stops a FABRICATED signal from
 * becoming a rule. Nothing stops a MISSING one: an agent that systematically fails
 * to notice a class of error also fails to log it, so the sample is biased in
 * exactly the shape of its blind spots, and every rule inherits that shape while
 * wearing a receipt that says otherwise.
 *
 * A machine-written record is boring, mechanical and complete, which is what
 * evidence should be. `source` keeps it distinguishable from an agent's commentary
 * rather than blending the two.
 */

import type { GateVerdict } from "../contracts.js";

export type SignalSeverity = "low" | "medium" | "high";

export interface EmittableSignal {
  readonly type: string;
  readonly phase: string;
  readonly severity: SignalSeverity;
  readonly detail: string;
  /** Machine-authored. Hand-written signals carry no source. */
  readonly source: "gate";
  /** Identity for deduplication. Never written to the log as evidence. */
  readonly fingerprint: string;
}

/** What the log already holds. Hand-written entries have neither field. */
export interface ExistingSignal {
  readonly fingerprint?: string;
  readonly resolved_by?: string;
}

const clip = (s: string, n = 300): string =>
  s.trim().length <= n ? s.trim() : `${s.trim().slice(0, n)}…`;

/**
 * Two events are worth recording, and nothing else.
 *
 * A PASSING run is not news, and a log that records success is a log nobody reads.
 * An ADVISORY finding is the lens doing its job, not friction; emitting one per run
 * would drown the retro in the ordinary and recurrence would stop meaning anything.
 */
export function signalsFromGate(verdict: GateVerdict, range: string): EmittableSignal[] {
  const out: EmittableSignal[] = [];

  for (const result of verdict.results) {
    const { outcome } = result;

    if (outcome.status === "fail" && result.severity === "block") {
      out.push({
        type: "gate-blocked",
        phase: "verify",
        severity: "medium",
        detail: `\`${result.checkId}\` (v${result.checkVersion}) blocked a change over ${range}: ${clip(outcome.detail)}`,
        source: "gate",
        fingerprint: `gate-blocked:${result.checkId}:${result.checkVersion}`,
      });
    }

    if (outcome.status === "errored") {
      // HIGH regardless of the check's severity. A check that cannot run is the
      // gate being broken, and a broken gate silently stops verifying everything
      // it covers. That is worse than a failing check, which at least still tells
      // you something true.
      out.push({
        type: "check-could-not-run",
        phase: "verify",
        severity: "high",
        detail: `\`${result.checkId}\` (severity ${result.severity}) could not run over ${range}, so nothing it covers was verified: ${clip(outcome.detail)}`,
        source: "gate",
        fingerprint: `check-could-not-run:${result.checkId}:${clip(outcome.detail, 60)}`,
      });
    }
  }

  return out;
}

/**
 * Drop anything the log already carries unresolved.
 *
 * Without this, running the gate five times while fixing one failure appends five
 * identical signals. The retro clusters on RECURRENCE, so that would turn "how many
 * times someone re-ran the gate" into evidence, and a rule would be proposed on the
 * strength of an impatient loop. It is a poisoning vector the anti-poisoning gate
 * cannot see, because every one of those signals is genuine.
 *
 * A signal whose earlier twin was RESOLVED is re-emitted: the receipt proves it was
 * closed, so its return is a regression, and regressions are real news.
 */
export function dedupe(
  candidates: readonly EmittableSignal[],
  existing: readonly ExistingSignal[],
): EmittableSignal[] {
  const open = new Set(
    existing
      .filter((s) => s.fingerprint !== undefined && s.resolved_by === undefined)
      .map((s) => s.fingerprint),
  );

  const out: EmittableSignal[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (open.has(c.fingerprint) || seen.has(c.fingerprint)) continue;
    seen.add(c.fingerprint);
    out.push(c);
  }
  return out;
}
