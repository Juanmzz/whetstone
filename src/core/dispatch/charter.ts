/**
 * The crewmate charter. PURE — builds the prompt a dispatched agent starts from.
 *
 * The asymmetry worth understanding: when Whetstone runs a REVIEW LENS it makes the
 * call hermetic, stripping the target repo's `AGENTS.md`, MCP servers and hooks so a
 * repo cannot hijack its own reviewer. A CREWMATE is the exact opposite — `.wst/` IS
 * its charter and must be loaded. Same binary, opposite flags. See
 * `.wst/architecture.md` and `src/shell/claude.ts`.
 *
 * The charter is a MAP, not a copy. Inlining the constitution into every crewmate
 * prompt is exactly the waste `token-economy` exists to stop; the crewmate can read
 * the files itself, and it has tools to do so.
 */

import type { Check } from "../checks/schema.js";
import type { TriageRule } from "../contracts.js";
import { DEFINITION_DIR } from "../paths.js";

/** An orientation file the charter may point at, and what it is. */
export interface OrientationDoc {
  /** Repo-relative. The composition root stats exactly these. */
  readonly path: string;
  readonly note: string;
}

/**
 * Every file the charter is allowed to send a crewmate to, in reading order.
 *
 * The charter used to hardcode `AGENTS.md` and `.wst/architecture.md`. Neither is
 * written by `wst init --definitions-only` — the mode for a repo whose own harness
 * already owns that surface — and `architecture.md` is written by no mode at all: it
 * exists only in Whetstone's own repo. So the first install into a foreign repo
 * produced a charter ordering an agent to read two files that were not there
 * (sig-0041).
 *
 * The notes stay generic for the same reason. The old one explained
 * `architecture.md` as "FCIS: `core/` is pure and must never import from
 * `shell/`" — true here, asserted about someone else's repo.
 */
export const ORIENTATION_DOCS: readonly OrientationDoc[] = [
  { path: "AGENTS.md", note: "orientation, and the hard rules" },
  { path: "CLAUDE.md", note: "orientation, and the hard rules" },
  { path: `${DEFINITION_DIR}/architecture.md`, note: "how this system is built" },
  {
    path: `${DEFINITION_DIR}/constitution.md`,
    note: "the non-negotiables this project governs itself by",
  },
  { path: `${DEFINITION_DIR}/triage-rules.md`, note: "which discipline this change earns" },
];

/**
 * `AGENTS.md` and `CLAUDE.md` are ONE source of truth (ADR-0002) — where both exist,
 * `CLAUDE.md` is usually a one-line `@AGENTS.md` import. Naming both spends a
 * crewmate's first two reads on the same content.
 */
const VENDOR_ALIASES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

/**
 * The strict-tier globs a project's OWN triage rules declare.
 *
 * `wst run` used to pass Whetstone's three as a literal. In a payments API that
 * told a crewmate three directories it would never touch were the dangerous ones, and
 * told it nothing about `migrations/`. The rules are already loaded for `gatingChecks`
 * one line earlier; this is the file that exists to answer the question.
 *
 * Order is the rules' order, which is precedence order — most specific first.
 */
export function strictPathsFrom(rules: readonly TriageRule[]): readonly string[] {
  const globs = new Set<string>();
  for (const rule of rules) {
    if (rule.tier === "strict") globs.add(rule.glob);
  }
  return [...globs];
}

/** The docs to name: the candidate set, narrowed to what the target actually has. */
function orientationFor(presentDocs: readonly string[]): readonly OrientationDoc[] {
  const present = new Set(presentDocs);
  const canonicalVendor = VENDOR_ALIASES.find((path) => present.has(path));

  return ORIENTATION_DOCS.filter(
    (doc) =>
      present.has(doc.path) &&
      (!VENDOR_ALIASES.includes(doc.path) || doc.path === canonicalVendor),
  );
}

export interface GatingCheck {
  readonly id: string;
  readonly severity: Check["severity"];
  readonly description: string;
}

export interface CharterInput {
  readonly task: string;
  readonly worktreePath: string;
  readonly branch: string;
  /** Lane id when the crewmate is boundary-scoped, else null. */
  readonly lane: string | null;
  /** What will judge this work — the crewmate is told BEFORE it starts. */
  readonly gatingChecks: readonly GatingCheck[];
  /** Path prefixes where full TDD is mandatory. */
  readonly strictPaths: readonly string[];
  /**
   * Which of `ORIENTATION_DOCS` the target repo ACTUALLY has, as stat'd by the
   * composition root. The charter names nothing outside this set.
   */
  readonly presentDocs: readonly string[];
}

export function buildCharter(input: CharterInput): string {
  if (input.task.trim() === "") {
    throw new Error("refusing to dispatch a crewmate with an empty task");
  }

  const blocking = input.gatingChecks.filter((c) => c.severity === "block");
  const advisory = input.gatingChecks.filter((c) => c.severity !== "block");

  const lines: string[] = [
    `You are a crewmate dispatched by Whetstone.`,
    ``,
    `## Your task`,
    ``,
    input.task.trim(),
    ``,
    `## Where`,
    ``,
    `Work ONLY in \`${input.worktreePath}\` (branch \`${input.branch}\`). \`cd\` there first.`,
    `It is an isolated git worktree — other crewmates may be working in siblings of it.`,
    ``,
    `## Read before you write`,
    ``,
  ];

  const orientation = orientationFor(input.presentDocs);
  if (orientation.length > 0) {
    for (const doc of orientation) lines.push(`- \`${doc.path}\` — ${doc.note}`);
    lines.push(
      ``,
      `Read them from disk. They are not copied here on purpose — you have tools, and a`,
      `charter that inlines everything wastes the budget you need for the work.`,
    );
  } else {
    // Never invent a pointer. A charter that names a file the repo does not have is
    // worse than one that names none, because it reads as authoritative.
    lines.push(
      `This repo has no orientation file Whetstone can point you at. Read the code and`,
      `whatever \`${DEFINITION_DIR}/\` holds before you write, and say so in your report if there was`,
      `nothing to orient from.`,
    );
  }

  lines.push(``, `## What will gate your work`, ``);

  if (blocking.length > 0) {
    lines.push(`These BLOCK — the change cannot land while any of them fails:`);
    for (const c of blocking) lines.push(`  - \`${c.id}\` (block) — ${c.description}`);
    lines.push(``);
  }
  if (advisory.length > 0) {
    lines.push(`These are advisory — reported, never blocking:`);
    for (const c of advisory) lines.push(`  - \`${c.id}\` (${c.severity}) — ${c.description}`);
    lines.push(``);
  }
  if (blocking.length === 0 && advisory.length === 0) {
    lines.push(`No checks apply to this change. Hold yourself to the standard anyway.`);
    lines.push(``);
  }

  lines.push(
    `Run them yourself before you finish. Being told what judges you is the point —`,
    `a gate you cannot see is a trap, not a standard.`,
    ``,
    `## Discipline`,
    ``,
  );
  if (input.strictPaths.length > 0) {
    lines.push(`These paths are STRICT TIER — full TDD, RED first, no exceptions:`);
    for (const p of input.strictPaths) lines.push(`  - \`${p}\``);
  } else {
    // `wst init` allows this and says so in its notes: a low-risk project legitimately
    // classifies nothing strict. Printing the header with no paths under it reads as a
    // truncated charter; asserting a strict tier that the rules never declared is worse.
    lines.push(
      `Nothing in this repo is classified STRICT TIER — its triage rules declare no path`,
      `where full TDD is mandatory. That is the rules' answer, not permission to skip tests.`,
    );
  }
  lines.push(``);

  if (input.lane !== null) {
    lines.push(
      `## Your lane: \`${input.lane}\``,
      ``,
      `A hook DENIES writes outside your lane, including to shared contracts. If it`,
      `blocks you and the work genuinely needs that file, STOP and report it — the lane`,
      `split being wrong is useful information; working around it is not.`,
      ``,
    );
  }

  lines.push(
    `## Finishing`,
    ``,
    `- Commit on \`${input.branch}\` with a conventional-commits message.`,
    `- **Do not merge. Do not push.** You produce a diff; the gate and a human decide`,
    `  what happens to it. A worker that can merge its own work has no gate.`,
    `- Report what you did, what you deliberately left out, and anything you found that`,
    `  was wrong in the instructions themselves.`,
  );

  return lines.join("\n");
}

/**
 * Branch name from a task description: readable in `git branch`, safe as a ref.
 * Pure, and here rather than in the command because `commands/` is light tier and
 * nothing there is unit-tested — a slug function has more edge cases than it looks.
 */
/** Characters of slug after `run/`. Long enough to stay readable in `git branch`. */
const SLUG_MAX = 40;

export function branchNameFor(task: string): string {
  const full = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `run/${truncateAtWord(full) === "" ? "task" : truncateAtWord(full)}`;
}

/**
 * Cut at the last whole word that fits, not at the character.
 *
 * A plain `slice(0, 40)` amputates mid-word, and stripping a trailing hyphen does
 * not remove the stump it leaves. Observed: `run/fix-init-see-monorepos-and-their-tests-i`,
 * where `-i` is the start of a word that did not survive. A branch name is read by
 * a human in `git branch`, in `gh pr list` and in every merge commit forever, so a
 * visible amputation is a lasting piece of carelessness for no gain.
 *
 * A first word longer than the whole budget has no boundary to cut at; there a hard
 * cut is the honest answer, because an empty branch name is worse than a stump.
 */
function truncateAtWord(slug: string): string {
  if (slug.length <= SLUG_MAX) return slug;

  const cut = slug.lastIndexOf("-", SLUG_MAX);
  return cut <= 0 ? slug.slice(0, SLUG_MAX) : slug.slice(0, cut);
}
