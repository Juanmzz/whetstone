/**
 * Triage classification — Layer 2, the first half. PURE.
 *
 * Turns `ChangedFile[]` + `TriageRule[]` into the one number the whole gate hangs
 * off: which discipline this change gets. Three rules, all from
 * `.sdd/triage-rules.md`, and all of them load-bearing:
 *
 * 1. **First-match-wins, in rule order.** Order IS precedence. Not
 *    most-specific-wins: that would be an implicit ranking nobody wrote down,
 *    and reviewing a ruleset would mean simulating a resolver in your head.
 * 2. **The change's tier is the MAXIMUM across its files.** One `src/core/` file
 *    makes the whole change strict. Size only ever escalates, never de-escalates.
 * 3. **An unmatched file is `light`, not `off`.** A path the rules have never
 *    heard of is not evidence that it is trivial.
 *
 * `matches[]` records which rule won for each file, so a tier decision is
 * re-checkable months later without re-running anything.
 */

import type { Tier } from "../checks/schema.js";
import type { TriageResult, TriageRule } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import { matchesPathGlob } from "./glob.js";

/** The single entry in `TriageResult.matches`. `contracts.ts` leaves it unnamed. */
export type TriageMatch = TriageResult["matches"][number];

/**
 * Where a file lands when no rule matches it. `.sdd/triage-rules.md`: "Default
 * when a change matches nothing above: light." Deliberately NOT `off` — an
 * unrecognised path is an unknown, and an unknown gets reasoned about before
 * merge. It is also why a config cannot express the fallback as a trailing `**`
 * rule: `matchesGlob` will not let `**` cross a dot-leading segment (see
 * `glob.ts`), so such a rule would quietly miss every dotfile.
 */
export const FALLBACK_TIER: Tier = "light";
export const FALLBACK_REASON =
  "no rule matched — default tier per .sdd/triage-rules.md (an unrecognised path is not evidence of triviality)";

/**
 * The tier of a diff with no files. The maximum over an empty set is the bottom
 * of the lattice, and there is genuinely nothing to gate.
 *
 * The two rejected alternatives: throwing crashes `wst gate` on a branch that is
 * legitimately up to date, and `light` invents ceremony for zero files. Callers
 * that need to tell "nothing changed" from "everything was trivial" can: only the
 * empty diff has `matches: []`.
 */
export const EMPTY_DIFF_TIER: Tier = "off";

const TIER_RANK: Readonly<Record<Tier, number>> = { off: 0, light: 1, strict: 2 };

/** The stricter of two tiers. Total and commutative — escalation is a lattice join. */
export function maxTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function firstMatch(path: string, rules: readonly TriageRule[]): TriageRule | undefined {
  return rules.find((rule) => matchesPathGlob(path, rule.glob));
}

function classifyFile(file: ChangedFile, rules: readonly TriageRule[]): TriageMatch {
  const onPath = firstMatch(file.path, rules);
  const tier = onPath?.tier ?? FALLBACK_TIER;
  const reason = onPath?.reason ?? FALLBACK_REASON;

  /**
   * THE HOLE THIS CLOSES. `git mv src/core/gate.ts attic/gate.ts` reports only the
   * DESTINATION path, so classifying on it alone rates "remove the engine and put
   * it somewhere unclassified" as `light` — the largest blast radius the tool can
   * see, waved through. Taking the max of {new path, old path} can only escalate,
   * which is the direction the rules already commit to.
   *
   * A COPY is excluded on purpose: the source is untouched by a copy, so
   * escalating on it would rate `cp src/core/gate.ts scratch/` as a change to the
   * engine. False strict is how a gate loses the credibility it runs on.
   */
  if (file.status === "renamed" && file.oldPath !== undefined) {
    const onOldPath = firstMatch(file.oldPath, rules);
    if (onOldPath !== undefined && TIER_RANK[onOldPath.tier] > TIER_RANK[tier]) {
      return {
        file,
        tier: onOldPath.tier,
        reason: `${onOldPath.reason} — escalated by the pre-rename path ${file.oldPath}`,
      };
    }
  }

  return { file, tier, reason };
}

export function classify(
  files: readonly ChangedFile[],
  rules: readonly TriageRule[],
): TriageResult {
  const matches = files.map((file) => classifyFile(file, rules));

  const [first, ...rest] = matches;
  if (first === undefined) {
    return {
      tier: EMPTY_DIFF_TIER,
      matches: [],
      reason: `${EMPTY_DIFF_TIER} — no files changed; nothing to gate`,
    };
  }

  // Single pass: the winner is the FIRST file at the maximum tier, which makes
  // the printed reason stable under anything that does not change the diff.
  let tier = first.tier;
  let driver = first;
  for (const match of rest) {
    if (TIER_RANK[match.tier] > TIER_RANK[tier]) {
      tier = match.tier;
      driver = match;
    }
  }

  const atTier = matches.filter((m) => m.tier === tier).length;
  const noun = matches.length === 1 ? "file" : "files";

  return {
    tier,
    matches,
    reason: `${tier} — ${atTier} of ${matches.length} ${noun}; ${driver.file.path}: ${driver.reason}`,
  };
}
