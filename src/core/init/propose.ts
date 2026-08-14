/**
 * The draft. PURE — the prompt, the schema, and what a proposal is allowed to
 * become. The shell makes the call; nothing here spawns anything.
 *
 * ## Why the judge proposes and never decides
 *
 * Why a model may argue but not sign: adr-0003. The distinction that makes it safe is
 * between DECIDING and ARGUING — "where is a bug expensive here?" is not a fact about
 * the code, it is a declaration of what the owner is willing to lose, and everything
 * downstream hangs off it. `init` was the last command not following that shape.
 *
 * ## Evidence over assertion, enforced by the type
 *
 * A risk flag arrives with the paths that justify it, and a flag citing nothing is
 * DROPPED — not trusted, not kept with a caveat. It IS reported, as
 * `DISCARDED for lack of evidence`, which is harsher than a warning and is the point:
 * a confident `money: true` with no path behind it would arrive dressed as a finding.
 *
 * ## The hermetic constraint (hard rule 9)
 *
 * The judge runs with `--tools ""` and no filesystem — it cannot open one file. So
 * everything it must reason over is INLINED here. A prompt that says "read the
 * README" produces a confident answer about a repo the model never saw, which is
 * worse than no answer because it is indistinguishable from a real one.
 */

import { z } from "zod";
import type { RepoFacts, StackFacts } from "./detect.js";
import { NO_RISK, type InterviewAnswers, type RiskProfile } from "./interview.js";

/** The five flags, as the schema sees them. Same keys as `RiskProfile`. */
const RISK_FLAGS = [
  "money",
  "personalData",
  "productionData",
  "authn",
  "safetyCritical",
] as const;

export const ProposalSchema = z.object({
  purpose: z.string().min(1).describe("What this project is FOR, in one or two sentences."),
  purposeEvidence: z
    .string()
    .min(1)
    .describe("Which of the listed files or commits support that reading."),
  stack: z
    .string()
    .min(1)
    .describe("What this project is built with: language, runtime, framework, where it runs."),
  sourcePaths: z
    .array(z.string())
    .describe(
      "Globs where this project's own code lives, read off the file list — `src/**`, or " +
        "`apps/*/src/**` for a monorepo. Not tests, not docs, not build output.",
    ),
  risk: z
    .array(
      z.object({
        flag: z.enum(RISK_FLAGS),
        why: z.string().min(1).describe("Why a bug here is expensive, concretely."),
        citedPaths: z
          .array(z.string())
          .describe(
            "Paths FROM THE PROVIDED LIST that justify this flag. A flag with none will be discarded.",
          ),
      }),
    )
    .describe("Only flags you can justify. Omit the rest; do not include them as false."),
  strictPaths: z
    .array(
      z.object({
        glob: z.string().min(1),
        reason: z.string().min(1).describe("Why this path earns full TDD."),
      }),
    )
    .describe("Paths that must never ship without full TDD. Few, or none."),
});

export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * Flags the judge wanted to raise and could not justify.
 *
 * Surfaced rather than swallowed: "the model thought this repo handles money but
 * could not point at a file" is information the human should weigh, and silently
 * dropping it would hide a real signal behind a safety rule.
 */
export function unevidencedFlags(proposal: Proposal): readonly string[] {
  return proposal.risk.filter((r) => r.citedPaths.length === 0).map((r) => r.flag);
}

/** The proposal, reduced to exactly what `AnswersSchema` accepts. Reasoning does not survive. */
export function proposalToAnswers(proposal: Proposal): InterviewAnswers {
  const evidenced = new Set(
    proposal.risk.filter((r) => r.citedPaths.length > 0).map((r) => r.flag),
  );

  const risk: RiskProfile = {
    ...NO_RISK,
    ...Object.fromEntries(RISK_FLAGS.map((flag) => [flag, evidenced.has(flag)])),
  };

  return {
    purpose: proposal.purpose,
    risk,
    sourcePaths: proposal.sourcePaths,
    strictPaths: proposal.strictPaths.map((p) => ({ glob: p.glob, reason: p.reason })),
    stack: proposal.stack,
    // Left empty on purpose. Conventions are house style, and a model inferring them
    // from two commit subjects would be guessing at the one thing a team is touchiest
    // about. The human adds them or they stay empty.
    conventions: [],
  };
}

/** Enough for a project to say what it is; short enough not to swamp the file list. */
const README_CHARS = 4000;

function bullets(label: string, items: readonly string[], cap = 200): string {
  if (items.length === 0) return `${label}: none\n`;
  const shown = items.slice(0, cap);
  const more = items.length > cap ? `\n  ... and ${String(items.length - cap)} more` : "";
  return `${label}:\n${shown.map((i) => `  ${i}`).join("\n")}${more}\n`;
}

/**
 * Everything the judge gets. It cannot ask for more, so anything missing here is
 * something it will either omit or invent.
 */
export function buildProposalPrompt(
  facts: RepoFacts,
  stack: StackFacts,
  readme?: string | null,
): string {
  const scripts = Object.entries(facts.packageJson?.scripts ?? {}).map(
    ([name, cmd]) => `${name} = ${String(cmd)}`,
  );

  // Names only, not versions. What a project reaches for is the signal; which patch
  // release it pinned is noise that would crowd out the file list.
  const deps = [
    ...Object.keys(facts.packageJson?.dependencies ?? {}),
    ...Object.keys(facts.packageJson?.devDependencies ?? {}),
  ];

  // Truncated, not omitted. A long README would dominate the prompt, and the intent
  // a project states about itself is almost always in the opening.
  const readmeBlock =
    readme === undefined || readme === null || readme.trim() === ""
      ? "README: none found\n"
      : `README (first ${String(README_CHARS)} chars):\n${readme.slice(0, README_CHARS)}\n`;

  return [
    `You are drafting the definition of a software project so its owner can correct it.`,
    ``,
    `You cannot access this repository. Everything known about it is below. Do not`,
    `refer to anything that is not listed — if the evidence is not here, say so instead`,
    `of assuming. A confident answer about a file you were not shown is worse than no`,
    `answer, because nobody can tell the two apart.`,
    ``,
    `## Repository: ${facts.repoName}`,
    ``,
    // No `language:` line, and that is deliberate (ADR-0016). It used to be
    // decided by counting file extensions, and handing a judge a guess dressed as
    // a fact anchors its answer on the table's mistake. The file list is right
    // there; the judge reads it better than a table does.
    `package manager: ${stack.packageManager ?? "not declared anywhere readable"}`,
    `tests present: ${stack.hasTests ? "yes" : "no"}`,
    `contributors: ${facts.contributors === null ? "unknown" : String(facts.contributors)}`,
    ``,
    bullets("read off this repo's own files", stack.evidence),
    readmeBlock,
    bullets("package scripts", scripts),
    bullets("dependencies", deps, 80),
    bullets("recent commit subjects", facts.commitSubjects, 40),
    bullets("files", facts.files),
    `## What to produce`,
    ``,
    `1. **purpose** — what this project is FOR, not what it contains. One or two`,
    `   sentences. Cite which files or commits led you there.`,
    ``,
    `2. **stack** — what it is built with: language, runtime, framework, where it`,
    `   runs. Two lines at most, from the files and dependencies above. Say`,
    `   "unclear from what I was shown" rather than picking the likeliest ecosystem.`,
    ``,
    `3. **sourcePaths** — globs covering where this project's OWN code lives, read`,
    `   off the file list. \`src/**\`, or \`apps/*/src/**\` when the packages sit under`,
    `   one parent. Exclude tests, docs, config and build output. These become the`,
    `   scope of every check the gate runs, so a glob that is too wide makes the`,
    `   gate judge files nobody meant it to, and one that is too narrow leaves real`,
    `   code unwatched.`,
    ``,
    `4. **risk** — where a bug is expensive. Include a flag ONLY if you can point at`,
    `   a listed path that justifies it, and put those paths in citedPaths. A flag`,
    `   with no cited path is discarded before the owner sees it, so an unjustified`,
    `   guess costs you the finding. Omit flags that do not apply rather than`,
    `   listing them. Be specific in \`why\`: "webhook handler has no idempotency key,`,
    `   so a retry double-charges" beats "handles payments".`,
    ``,
    `5. **strictPaths** — paths that must never ship without full TDD and review.`,
    `   Few or none. Each needs a reason that would still make sense to someone`,
    `   deciding whether to RETIRE the rule in a year.`,
    ``,
    `This is a draft the owner will edit. Being wrong and specific is more useful to`,
    `them than being vague and safe: a wrong claim with a path attached gets corrected`,
    `in seconds, and a hedge gets accepted without thought.`,
  ].join("\n");
}

/** The reasoning, for the human. The answers file carries none of this. */
export function renderProposal(proposal: Proposal): string {
  const lines = [
    `purpose`,
    `  ${proposal.purpose}`,
    `  why: ${proposal.purposeEvidence}`,
    ``,
    `stack`,
    `  ${proposal.stack}`,
    ``,
    `source paths`,
    ...(proposal.sourcePaths.length === 0
      ? [`  none named — no check will be seeded, since one would have nothing to judge`]
      : proposal.sourcePaths.map((glob) => `  ${glob}`)),
    ``,
    `risk`,
  ];

  const kept = proposal.risk.filter((r) => r.citedPaths.length > 0);
  if (kept.length === 0) {
    lines.push(`  nothing flagged — a bug here costs a reviewer's patience and no more`);
  }
  for (const entry of kept) {
    lines.push(`  ${entry.flag}`);
    lines.push(`      ${entry.why}`);
    lines.push(`      cited: ${entry.citedPaths.join(", ")}`);
  }

  const dropped = unevidencedFlags(proposal);
  if (dropped.length > 0) {
    lines.push(``);
    lines.push(`  DISCARDED for lack of evidence: ${dropped.join(", ")}`);
    lines.push(`      The judge wanted these and could not name a file. Weigh that yourself.`);
  }

  lines.push(``, `strict paths`);
  if (proposal.strictPaths.length === 0) {
    lines.push(`  none proposed`);
  }
  for (const path of proposal.strictPaths) {
    lines.push(`  ${path.glob}`);
    lines.push(`      ${path.reason}`);
  }

  lines.push(
    ``,
    `This is a DRAFT. The risk answer especially is yours to confirm — it decides how`,
    `much ceremony this project buys, and it is a statement about what you are willing`,
    `to lose, which is not something a model can read off your code. Edit the file,`,
    `then run \`wst init --answers <file>\`.`,
  );

  return lines.join("\n");
}
