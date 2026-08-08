/**
 * Layer 2 — triage and routing. The public face of this lane.
 *
 * The pipeline (`core/contracts.ts` documents the whole of it):
 *   ChangedFile[] + TriageRule[] -> classify() -> TriageResult
 *                                              -> route(tier, checks) -> Routing
 *
 * `matchesAnyGlob` is exported for the gate: narrowing a check's `include` /
 * `exclude` against the changed files depends on the DIFF, not on the tier, so
 * it is not `route`'s job — but the matcher it needs is the same one, and two
 * glob implementations in one engine would eventually disagree.
 */

export { classify, maxTier, EMPTY_DIFF_TIER, FALLBACK_REASON, FALLBACK_TIER } from "./classify.js";
export type { TriageMatch } from "./classify.js";
export { route } from "./route.js";
export {
  parseTriageRules,
  DEFAULT_RULES,
  DEFAULT_RULES_YAML,
  TRIAGE_RULES_FORMAT,
} from "./rules.js";
export { matchesAnyGlob, matchesPathGlob } from "./glob.js";
