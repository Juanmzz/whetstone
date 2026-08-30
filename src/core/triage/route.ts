/**
 * Triage routing — Layer 2, the second half. PURE.
 */

import type { Check, Tier } from "../checks/schema.js";
import type { Autonomy, Routing } from "../contracts.js";

interface TierPolicy {
  readonly autonomy: Autonomy;
  readonly modelTier: Routing["modelTier"];
  readonly autofix: boolean;
}

/** The model a check in this tier would be judged by. */
export function modelForTier(tier: Tier): Routing["modelTier"] {
  return POLICY[tier].modelTier;
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
