/**
 * Retro steps 3-4: the recommendation, and the anti-poisoning gate that must pass
 * BEFORE a human ever sees it. PURE.
 *
 * Why this exists (OWASP ASI06, and `docs/woz/retro.md` §4): the retro's proposal is
 * AGENT-GENERATED. A human gate alone is not enough — a plausible proposal citing a
 * signal that never happened is exactly the thing a tired reviewer rubber-stamps. So
 * the machine checks the machine's own evidence first, deterministically, and a
 * recommendation that fails never reaches the human at all.
 *
 * The division of labour: the LLM proposes (judgment), this validates the citations
 * and the blast radius (mechanical), the human disposes (authority).
 */

import { DEFINITION_DIR } from "../paths.js";
import type { Signal } from "./cluster.js";

export type RecommendationKind =
  /** Strengthen or add a rule in an existing skill. */
  | "amend"
  /** An advisory rule ignored repeatedly → compile it into an enforced hook. */
  | "graduate-to-hook"
  /** A repeated manual sequence → a command. */
  | "command"
  /** A proven solution exists in the wild → curate it rather than reinvent. */
  | "curate"
  /** Nothing off-the-shelf fits → generate something project-specific. */
  | "generate"
  /** A decision was wrong or overtaken → supersede it (never edit its prose). */
  | "flip-adr";

export interface Recommendation {
  /** The cluster this came from, so the proposal traces back to its evidence. */
  readonly clusterKey: string;
  readonly kind: RecommendationKind;
  /** The `.sdd/` file this would change. */
  readonly target: string;
  readonly summary: string;
  readonly rationale: string;
  /** The signals that earn this. THE RECEIPT. */
  readonly citedSignals: readonly string[];
}

export type Validation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** Human-owned. The retro proposes rules; it never rewrites what rules may be. */
const NEVER_TOUCH = [`${DEFINITION_DIR}/constitution.md`];

export function validateRecommendation(
  rec: Recommendation,
  log: readonly Signal[],
): Validation {
  const reasons: string[] = [];
  const known = new Set(log.map((s) => s.id));

  // 1. Every cited signal must be REAL. This is the anti-poisoning check.
  if (rec.citedSignals.length === 0) {
    reasons.push(
      "cites no signals — a rule with a receipt is earned, a rule without one is a guess",
    );
  }
  for (const id of rec.citedSignals) {
    if (!known.has(id)) {
      reasons.push(`cites ${id}, which is not in signals.jsonl — the evidence does not exist`);
    }
  }
  const seen = new Set<string>();
  for (const id of rec.citedSignals) {
    if (seen.has(id)) reasons.push(`cites ${id} more than once — duplicate citations inflate the evidence`);
    seen.add(id);
  }

  // 2. Blast radius. The retro may only change `.sdd/`, and never the constitution.
  if (NEVER_TOUCH.includes(rec.target)) {
    reasons.push(
      `targets ${rec.target}, which the retro never amends — the constitution is human-owned`,
    );
  }
  if (!rec.target.startsWith(`${DEFINITION_DIR}/`)) {
    reasons.push(
      `targets ${rec.target}, which is outside ${DEFINITION_DIR}/ — the retro amends rules, not code`,
    );
  }

  // 3. A proposal a human cannot evaluate is not a proposal.
  //
  // "Empty" is not the only way to be unreviewable. The first real retro returned
  // proposals whose entire body was the word "placeholder" — the model knew it lacked
  // the information and said so, and the gate passed them through to a human anyway.
  // A proposal that admits it could not propose must be dropped, not forwarded.
  const PLACEHOLDER = /^\s*(placeholder|tbd|todo|n\/a)\b/i;
  const MIN_RATIONALE = 60;

  if (rec.rationale.trim() === "") reasons.push("has no rationale — it cannot be reviewed");
  else if (PLACEHOLDER.test(rec.rationale)) {
    reasons.push("its rationale is a placeholder — the proposer had nothing to say");
  } else if (rec.rationale.trim().length < MIN_RATIONALE) {
    reasons.push(
      `its rationale is ${rec.rationale.trim().length} chars — too thin to review; a rule ` +
        `nobody can evaluate cannot be approved`,
    );
  }

  if (rec.summary.trim() === "") reasons.push("has no summary");
  else if (PLACEHOLDER.test(rec.summary)) reasons.push("its summary is a placeholder");

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Renders a validated recommendation for the human gate. */
export function renderProposal(rec: Recommendation, n: number): string {
  return [
    `### Proposal ${n} — ${rec.kind}: ${rec.target}`,
    ``,
    `**${rec.summary}**`,
    ``,
    rec.rationale,
    ``,
    `- cluster: \`${rec.clusterKey}\``,
    `- receipt: ${rec.citedSignals.map((s) => `\`${s}\``).join(", ")}`,
  ].join("\n");
}
