/**
 * Layer 2 — triage and routing. The public face of this lane.
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
