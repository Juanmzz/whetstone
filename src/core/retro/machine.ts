/**
 * `wst retro` as data.
 *
 * PURE.
 *
 * The retro's output is a set of proposed rule changes, each carrying the signals
 * that earn it. A human signs them (adr-0003) — but the thing that PRESENTS them
 * is increasingly an agent, and an agent handed prose paraphrases it. A paraphrased
 * proposal is a rule change nobody actually approved.
 *
 * ## Two fields that are easy to drop and should not be
 *
 * `rejected` carries its REASONS, not a count. The anti-poisoning gate —
 * `validateRecommendation` against the full log — is the most interesting thing
 * this command does, and a caller seeing only accepted proposals cannot tell a
 * quiet retro from one that just caught a fabricated citation.
 *
 * `applied` is stated rather than implied, for the same reason `prepare` states
 * `dispatched`: the whole design is that this never writes, and a consumer that
 * assumed otherwise would report a change that did not happen.
 */

import type { Recommendation } from "./propose.js";

export interface RetroFacts {
  readonly signals: number;
  readonly fresh: number;
  readonly clusters: number;
  readonly accepted: readonly Recommendation[];
  readonly rejected: readonly { readonly rec: Recommendation; readonly reasons: readonly string[] }[];
  readonly costUsd: number;
}

export interface RetroEnvelope {
  readonly signals: { readonly total: number; readonly fresh: number; readonly clusters: number };
  readonly proposals: readonly Recommendation[];
  readonly rejected: readonly {
    readonly target: string;
    readonly summary: string;
    readonly reasons: readonly string[];
  }[];
  /** Always false. The retro proposes; a human signs (adr-0003). */
  readonly applied: false;
  readonly costUsd: number;
}

export function retroEnvelope(facts: RetroFacts): RetroEnvelope {
  return {
    signals: { total: facts.signals, fresh: facts.fresh, clusters: facts.clusters },
    proposals: facts.accepted.map((rec) => ({ ...rec, citedSignals: [...rec.citedSignals] })),
    rejected: facts.rejected.map(({ rec, reasons }) => ({
      target: rec.target,
      summary: rec.summary,
      reasons: [...reasons],
    })),
    applied: false,
    costUsd: facts.costUsd,
  };
}
