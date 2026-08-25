/**
 * The interview — the "ask everything the repo does not declare" half of `wst init`.
 *
 * Six questions, each carrying the `why` it is asked at all. `source-paths` and
 * `stack` are new: they used to be inferred by a directory-name list and a
 * file-extension table inside `detect.ts`, both removed by adr-0016.
 */

import { z } from "zod";
import { OPINIONS } from "../opinions/index.js";
import { DEFINITION_DIR } from "../paths.js";

export type QuestionId =
  | "purpose"
  | "risk"
  | "source-paths"
  | "strict-paths"
  | "stack"
  | "conventions"
  | "opinions";

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
  /**
   * Where this project's code lives, as globs. The single source of two outputs:
   * the `light` triage rules and the `include` of every seeded check. Empty is a
   * legitimate answer — a repo with no code yet — and it means no check is seeded
   * rather than one scoped to `**`.
   */
  readonly sourcePaths: readonly string[];
  readonly strictPaths: readonly StrictPath[];
  /** What the project is built with, verbatim into the constitution. May be null. */
  readonly stack: string | null;
  /** Free-form bullets for the constitution's Conventions section. May be empty. */
  readonly conventions: readonly string[];
  /**
   * Ids from the opinion catalogue the human said yes to. Empty is the default and
   * the answer a skipped question gives: an opinion is offered, never seeded.
   */
  readonly opinions: readonly string[];
}

const RISK_LABELS: readonly (readonly [keyof RiskProfile, string])[] = [
  ["money", "money: payments, balances, pricing, billing"],
  ["personalData", "personal data: PII, health, identity documents"],
  ["productionData", "production data: live customer records, destructive migrations"],
  ["authn", "auth: authentication, authorisation, secrets, access control"],
  ["safetyCritical", "safety-critical: physical control, medical, anything that can hurt someone"],
];

/**
 * The questions, in the order they are asked. They do not depend on what was
 * read: `detectStack` answers a disjoint set of facts, so nothing it finds can
 * remove a question from this list or pre-fill one. That independence is the
 * point — an interview that shrinks when a table gets lucky is an interview whose
 * coverage nobody can state.
 */
export function buildInterview(): readonly InitQuestion[] {
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
      id: "source-paths",
      prompt:
        "Where does this project's code live? One glob per source root " +
        "(`src/**`, or `apps/*/src/**` for a monorepo).",
      why:
        "A directory called `src` is a convention, not a declaration, and the repo that " +
        "calls it `services/` is invisible to any list of names. These globs become the " +
        "`light` triage rules and the `include` of every seeded check, so a wrong one puts " +
        "the gate over the wrong files.",
      kind: "paths",
      options: [],
      defaultAnswer: null,
    },
    {
      id: "strict-paths",
      prompt:
        "Which paths must never ship without full TDD and review? Give a glob and the " +
        "reason it earns that (`src/billing/** : moves money`).",
      why:
        "Which part of the code is dangerous is a judgement about what you are willing to " +
        "lose. No layout states it.",
      kind: "paths",
      options: [],
      defaultAnswer: null,
    },
    {
      id: "stack",
      prompt:
        "What is this project built with? Language, runtime, framework, where it runs. " +
        "the two lines a new contributor needs.",
      why:
        "A repo declares its scripts and its package manager, and `init` reads both. What " +
        "it is WRITTEN in is not stated anywhere; it used to be counted off file " +
        "extensions, which is exactly the guess that breaks on an unusual stack.",
      kind: "text",
      options: [],
      defaultAnswer: null,
    },
    {
      id: "conventions",
      prompt:
        "Any non-negotiable conventions? (commit format, language of code and docs, style " +
        "rules a reviewer would reject a PR over)",
      why:
        "A commit history is a pattern, not a promise. Reading four `feat:` subjects and " +
        "writing `this project uses Conventional Commits` into a constitution states a rule " +
        "nobody agreed to.",
      kind: "text",
      options: [],
      defaultAnswer: null,
    },
  ];

  questions.push({
    id: "opinions",
    prompt:
      "Whetstone has opinions no repo declares, each earned by getting it wrong somewhere. " +
      "Select any you want here, or none.",
    why:
      "Nothing on disk asks for these, and seeding one unasked is the pile of config from " +
      "guesses this interview exists to avoid. One question however many ship, so the count " +
      "does not grow with the catalogue.",
    kind: "flags",
    options: OPINIONS.map((o) => ({ value: o.id, label: `${o.title}: ${o.friction}` })),
    defaultAnswer: null,
  });

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
    `\`${DEFINITION_DIR}/triage-rules.md\` exists to slow down.`;
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
    errors.push("purpose is blank; the constitution would ship with a hole where its intent goes");
  }

  if (riskIsElevated(answers.risk) && answers.strictPaths.length === 0) {
    const hits = RISK_LABELS.filter(([key]) => answers.risk[key] === true).map(([key]) => key);
    errors.push(
      `risk profile declares ${hits.join(", ")} but names no strict path. An elevated risk ` +
        `profile that maps to nothing concrete is a comment, not a rule. Name the paths ` +
        `where that risk actually lives.`,
    );
  }

  for (const glob of answers.sourcePaths) {
    if (glob.trim().length === 0) {
      errors.push(
        "a source path is blank. It would travel into a check's `include`, where a glob " +
          "matching nothing makes the check silently judge no file at all.",
      );
    }
  }

  const seen = new Set<string>();
  for (const path of answers.strictPaths) {
    if (path.glob.trim().length === 0) {
      errors.push("a strict path has a blank glob; a rule that matches nothing is dead weight");
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
        `duplicate strict glob "${path.glob.trim()}": triage is first-match-wins, so the ` +
          `second one can never fire. Merge them, or narrow one.`,
      );
    }
    seen.add(path.glob.trim());
  }

  return errors;
}

/**
 * `InterviewAnswers` as data on disk. Read by `--answers`, and by the base a
 * repo records so `wst update` knows what it was asked.
 */
export const AnswersSchema = z.strictObject({
  purpose: z.string(),
  risk: z
    .strictObject({
      money: z.boolean().default(false),
      personalData: z.boolean().default(false),
      productionData: z.boolean().default(false),
      authn: z.boolean().default(false),
      safetyCritical: z.boolean().default(false),
      note: z.string().nullable().default(null),
    })
    .default(NO_RISK),
  // Defaulted, not required: an answers file written before these two questions
  // existed still parses, and lands on the same blank a skipped question does.
  sourcePaths: z.array(z.string()).default([]),
  strictPaths: z
    .array(z.strictObject({ glob: z.string(), reason: z.string() }))
    .default([]),
  stack: z.string().nullable().default(null),
  conventions: z.array(z.string()).default([]),
  // Defaulted: an answers file written before opinions existed means "none", which
  // is also what a skipped question means.
  opinions: z.array(z.string()).default([]),
});

