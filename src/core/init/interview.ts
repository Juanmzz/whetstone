/**
 * The interview — the "ask only what you cannot infer" half of `wst init`.
 *
 * PURE, and deliberately so: this module returns the QUESTIONS AS DATA. It never
 * prompts, never reads stdin, never prints. The composition root decides how to
 * ask (a coding agent asking a human in chat, flags on the CLI, a JSON file), and
 * the engine stays testable and non-interactive.
 *
 * `docs/woz/init.md` step 2 lists six questions. Four of them are answerable
 * from the repo once `detectStack` has run, so this module asks THREE by default:
 *
 * | WoZ question         | here                                                   |
 * |----------------------|--------------------------------------------------------|
 * | purpose              | asked — prose intent is not on disk                     |
 * | risk profile         | asked — the one thing no file states                    |
 * | strict paths         | asked, pre-filled with the detected source dirs         |
 * | conventions          | asked ONLY when git history revealed no commit style    |
 * | working relationship | not asked — `skills/voice.md` ships calibrated defaults |
 * | backend              | not asked — `files` is the default AND the recommendation |
 *
 * The last two are recorded deviations, not oversights: neither answer changes a
 * single byte of what init generates, so asking would spend the human's attention
 * on nothing. A backend other than `files` is a flag on the composition root.
 */

import type { StackFacts } from "./detect.js";

export type QuestionId = "purpose" | "risk" | "strict-paths" | "conventions";

export interface QuestionOption {
  readonly value: string;
  readonly label: string;
}

export interface InitQuestion {
  readonly id: QuestionId;
  readonly prompt: string;
  /** Why the repo could not answer this. Makes over-asking visible in review. */
  readonly why: string;
  readonly kind: "text" | "flags" | "paths";
  readonly options: readonly QuestionOption[];
  /** Pre-filled answer the human can accept, or null when there is nothing to offer. */
  readonly defaultAnswer: string | null;
}

/**
 * The risk profile. Modelled as explicit flags rather than free text because it
 * DRIVES a decision — an elevated profile makes at least one strict path
 * mandatory (see `validateAnswers`) — and a decision cannot be driven off prose.
 */
export interface RiskProfile {
  readonly money: boolean;
  readonly personalData: boolean;
  readonly productionData: boolean;
  readonly authn: boolean;
  readonly safetyCritical: boolean;
  /** Anything the flags do not capture. Rendered verbatim into the constitution. */
  readonly note: string | null;
}

export const NO_RISK: RiskProfile = Object.freeze({
  money: false,
  personalData: false,
  productionData: false,
  authn: false,
  safetyCritical: false,
  note: null,
});

export interface StrictPath {
  readonly glob: string;
  /** MANDATORY, same reasoning as `TriageRule.reason`: no reason, no review, no retirement. */
  readonly reason: string;
}

export interface InterviewAnswers {
  readonly purpose: string;
  readonly risk: RiskProfile;
  readonly strictPaths: readonly StrictPath[];
  /** Free-form bullets for the constitution's Conventions section. May be empty. */
  readonly conventions: readonly string[];
}

const RISK_LABELS: readonly (readonly [keyof RiskProfile, string])[] = [
  ["money", "money — payments, balances, pricing, billing"],
  ["personalData", "personal data — PII, health, identity documents"],
  ["productionData", "production data — live customer records, destructive migrations"],
  ["authn", "auth — authentication, authorisation, secrets, access control"],
  ["safetyCritical", "safety-critical — physical control, medical, anything that can hurt someone"],
];

export function buildInterview(stack: StackFacts): readonly InitQuestion[] {
  const questions: InitQuestion[] = [
    {
      id: "purpose",
      prompt: "What is this project, in one or two sentences?",
      why: "Intent is not on disk. A README describes what exists; this asks what it is FOR.",
      kind: "text",
      options: [],
      defaultAnswer: null,
    },
    {
      id: "risk",
      prompt:
        "Where is a bug expensive here? Select every one that applies, or none if a bug " +
        "costs a reviewer's patience and nothing more.",
      why:
        "No file states this. It is the single input that decides how much ceremony the " +
        "project buys, so it is the one question worth interrupting for.",
      kind: "flags",
      options: RISK_LABELS.map(([value, label]) => ({ value, label })),
      defaultAnswer: null,
    },
    {
      id: "strict-paths",
      prompt:
        "Which paths must never ship without full TDD and review? Give a glob and the " +
        "reason it earns that (`src/billing/** : moves money`).",
      why:
        stack.sourceGlobs.length > 0
          ? "The source layout is visible; which part of it is dangerous is not."
          : "Nothing recognisable to point at yet — name the core domain once it exists.",
      kind: "paths",
      options: [],
      defaultAnswer: stack.sourceGlobs.length > 0 ? (stack.sourceGlobs[0] ?? null) : null,
    },
  ];

  // Only asked when git could not answer it. A repo with a commit history has
  // already voted on its own convention, and asking again invites a different
  // answer than the one the repo actually follows.
  if (stack.commitStyle === "unknown") {
    questions.push({
      id: "conventions",
      prompt:
        "Any non-negotiable conventions? (commit format, language of code and docs, style " +
        "rules a reviewer would reject a PR over)",
      why: "Git history is too short or too varied to infer a commit convention from.",
      kind: "text",
      options: [],
      defaultAnswer: "code and config in English; Conventional Commits",
    });
  }

  return questions;
}

export function riskIsElevated(risk: RiskProfile): boolean {
  return RISK_LABELS.some(([key]) => risk[key] === true);
}

export function renderRiskProfile(risk: RiskProfile): string {
  const hits = RISK_LABELS.filter(([key]) => risk[key] === true).map(([, label]) => label);
  const note = risk.note === null || risk.note.trim().length === 0 ? null : risk.note.trim();

  if (hits.length === 0) {
    const base =
      "No money, personal data, production data, auth or safety-critical surface. The " +
      "primary risk is correctness and legibility for a reviewer, so triage discipline is " +
      "about keeping the change small and reviewable, not about blast radius.";
    return note === null ? base : `${base}\n\n${note}`;
  }

  const lines = hits.map((h) => `- ${h}`).join("\n");
  const tail =
    "\n\nA bug in these areas is expensive, which is what the `strict` row in " +
    "`.sdd/triage-rules.md` exists to slow down.";
  return note === null ? `${lines}${tail}` : `${lines}${tail}\n\n${note}`;
}

/**
 * Answers are validated BEFORE anything is generated. A constitution with a blank
 * purpose, or a "handles money" project with no strict path, is a payload that
 * looks installed and governs nothing — the worst outcome for a tool whose whole
 * claim is that the rules are real.
 */
export function validateAnswers(answers: InterviewAnswers): readonly string[] {
  const errors: string[] = [];

  if (answers.purpose.trim().length === 0) {
    errors.push("purpose is blank — the constitution would ship with a hole where its intent goes");
  }

  if (riskIsElevated(answers.risk) && answers.strictPaths.length === 0) {
    const hits = RISK_LABELS.filter(([key]) => answers.risk[key] === true).map(([key]) => key);
    errors.push(
      `risk profile declares ${hits.join(", ")} but names no strict path. An elevated risk ` +
        `profile that maps to nothing concrete is a comment, not a rule — name the paths ` +
        `where that risk actually lives.`,
    );
  }

  const seen = new Set<string>();
  for (const path of answers.strictPaths) {
    if (path.glob.trim().length === 0) {
      errors.push("a strict path has a blank glob — a rule that matches nothing is dead weight");
      continue;
    }
    if (path.reason.trim().length === 0) {
      errors.push(
        `strict path "${path.glob}" has no reason. A rule that cannot say why it exists ` +
          `cannot be reviewed, and therefore can never be retired.`,
      );
    }
    if (seen.has(path.glob.trim())) {
      errors.push(
        `duplicate strict glob "${path.glob.trim()}" — triage is first-match-wins, so the ` +
          `second one can never fire. Merge them, or narrow one.`,
      );
    }
    seen.add(path.glob.trim());
  }

  return errors;
}
