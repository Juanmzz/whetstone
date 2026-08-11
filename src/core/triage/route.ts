/**
 * Triage routing — Layer 2, the second half. PURE.
 *
 * Turns a tier into the operating envelope for the change: which checks run, who
 * signs off, which model does the judging, and whether a failure may be patched
 * up automatically.
 *
 * THE PRINCIPLE: **autonomy is inverse to criticality.** The most consequential
 * changes keep a human in the loop and are never auto-fixed; the trivial ones go
 * to the cheapest model and are left alone. Inverting either half is how an
 * autonomous agent quietly "fixes" the engine that decides whether its own work
 * is acceptable — and an autofix on a strict change is a second, unreviewed
 * change smuggled in under the first one's review.
 *
 * The frugality half is the same table read the other way (`.wst/architecture.md`):
 * opus judgment is spent only where a wrong verdict is expensive.
 */

import type { Check, Tier } from "../checks/schema.js";
import type { Autonomy, Routing } from "../contracts.js";

interface TierPolicy {
  readonly autonomy: Autonomy;
  readonly modelTier: Routing["modelTier"];
  readonly autofix: boolean;
}

/**
 * Exhaustive by type: `Record<Tier, …>` means adding a tier to
 * `checks/schema.ts` fails to compile until its policy is written down, rather
 * than falling through to a permissive default.
 */
const POLICY: Readonly<Record<Tier, TierPolicy>> = {
  strict: { autonomy: "human-gate", modelTier: "opus", autofix: false },
  light: { autonomy: "autonomous", modelTier: "sonnet", autofix: true },
  off: { autonomy: "autonomous", modelTier: "haiku", autofix: true },
};

/**
 * Selects the checks that apply at this tier.
 *
 * Two filters and no more: the check must declare the tier, and it must be
 * enabled. `enabled: false` is the kill switch — honouring it here is what lets a
 * check be retired without deleting it and its history. Per-file `include` /
 * `exclude` narrowing is deliberately NOT done here: it depends on the diff, not
 * the tier, and belongs to whoever is holding both.
 *
 * Registry order is preserved rather than re-sorted. The registry already sorts
 * by id; a second opinion about ordering here could only diverge from it.
 */
export function route(tier: Tier, checks: readonly Check[]): Routing {
  const policy = POLICY[tier];
  return {
    tier,
    checks: checks.filter((c) => c.enabled && c.tiers.includes(tier)).map((c) => c.id),
    autonomy: policy.autonomy,
    modelTier: policy.modelTier,
    autofix: policy.autofix,
  };
}
