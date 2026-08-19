/**
 * `wst retro` as data.
 *
 * PURE.
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
