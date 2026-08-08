/**
 * Criticality — Layer 5, and the single rule the whole annotation layer exists for.
 * PURE.
 *
 * ## THE RULE: the tier is a FLOOR, a finding is the TRIGGER
 *
 * The obvious implementation is `max(tier, finding)` with `strict` mapped to red.
 * It is wrong, and wrong in the way that destroys the product rather than in a way
 * that shows up as a bug:
 *
 *   A change touching 40 files under `src/core/` is entirely strict tier. Under
 *   max(), all 40 go red. The reviewer opens the PR, sees forty red markers, and
 *   learns exactly what they knew before opening it — that this is engine code.
 *   The one file with a real finding is indistinguishable from the 39 without one.
 *
 * An annotation whose output is constant is not an annotation. So the tier's own
 * contribution is CAPPED at `skim`:
 *
 *   `tierFloor(strict) = skim`  —  strict tier alone is never red
 *   `tierFloor(light)  = skip`
 *   `tierFloor(off)    = skip`
 *
 * and the level a file actually reaches is the join of that floor with what the
 * findings on it trigger:
 *
 *   | tier   | block finding | warn/annotate finding | no finding |
 *   |--------|---------------|------------------------|-----------|
 *   | strict | 🔴 review     | 🟡 skim                | 🟡 skim   |
 *   | light  | 🔴 review     | 🟡 skim                | ⚪ skip   |
 *   | off    | 🔴 review     | 🟡 skim                | ⚪ skip   |
 *
 * It is still a lattice join — the difference is entirely in what the tier is
 * allowed to contribute. `naiveMaxCriticality` is kept below so the difference is
 * demonstrable in a test rather than asserted in this comment.
 *
 * ## What is deliberately NOT here
 *
 * An `errored` check is not a finding and never appears in `findings`. The gate
 * already draws that line (`core/gate/aggregate.ts`, rule 1): a check that could not
 * run has produced no judgement about the change. Letting it raise criticality would
 * turn a broken judge into forty red files — the same signal collapse by another
 * route. It is surfaced as "not verified", never as red. See `annotate.ts`.
 */

import type { Check, Tier } from "../checks/schema.js";

/** 🔴 look here · 🟡 worth a skim · ⚪ nothing here for you. */
export const CRITICALITIES = ["review", "skim", "skip"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const MARK: Readonly<Record<Criticality, string>> = {
  review: "🔴",
  skim: "🟡",
  skip: "⚪",
};

export const LABEL: Readonly<Record<Criticality, string>> = {
  review: "review",
  skim: "skim",
  skip: "skip",
};

const RANK: Readonly<Record<Criticality, number>> = { skip: 0, skim: 1, review: 2 };

/** The more critical of two. Total and commutative. */
export function joinCriticality(a: Criticality, b: Criticality): Criticality {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * What the tier alone buys a file — the FLOOR, never more.
 *
 * `strict` earns a skim because a human should glance at engine code regardless of
 * what the checks said; it does not earn red, because "this is engine code" is a
 * property of the path, not of the change, and a marker that is on for every file
 * in a directory carries no information.
 */
export function tierFloor(tier: Tier): Criticality {
  return tier === "strict" ? "skim" : "skip";
}

/**
 * What one finding triggers. Severity is obeyed exactly as `aggregate` obeys it: a
 * `warn` check that failed is advisory by the check author's own declaration, and
 * promoting it to red here would smuggle back the blocking power the severity cap
 * exists to deny it (see `core/gate/aggregate.ts`, invariant 2).
 */
export function findingTrigger(severity: Check["severity"]): Criticality {
  return severity === "block" ? "review" : "skim";
}

/** Anything carrying a severity. Structural so `criticality.ts` need not know about `Finding`. */
export interface Severed {
  readonly severity: Check["severity"];
}

/** The composed rule. `findings` are the ATTRIBUTED findings landing on this file. */
export function criticalityFor(tier: Tier, findings: readonly Severed[]): Criticality {
  let level = tierFloor(tier);
  for (const finding of findings) level = joinCriticality(level, findingTrigger(finding.severity));
  return level;
}

/**
 * THE WRONG RULE, kept on purpose.
 *
 * `max(tier, finding)` with `strict` mapped straight to red. It exists so
 * `criticality.test.ts` can demonstrate the failure mode against the same input
 * instead of describing it, and so a future reader who thinks "surely max is
 * simpler" finds the counter-example already written down. Nothing outside the
 * tests may call it — it is not exported from `index.ts`.
 */
export function naiveMaxCriticality(tier: Tier, findings: readonly Severed[]): Criticality {
  const fromTier: Criticality = tier === "strict" ? "review" : tier === "light" ? "skim" : "skip";
  let level = fromTier;
  for (const finding of findings) level = joinCriticality(level, findingTrigger(finding.severity));
  return level;
}
