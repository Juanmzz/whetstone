/**
 * The crewmate charter. PURE — builds the prompt a dispatched agent starts from.
 *
 * The asymmetry worth understanding: when Whetstone runs a REVIEW LENS it makes the
 * call hermetic, stripping the target repo's `AGENTS.md`, MCP servers and hooks so a
 * repo cannot hijack its own reviewer. A CREWMATE is the exact opposite — `.sdd/` IS
 * its charter and must be loaded. Same binary, opposite flags. See
 * `.sdd/architecture.md` and `src/shell/claude.ts`.
 *
 * The charter is a MAP, not a copy. Inlining the constitution into every crewmate
 * prompt is exactly the waste `token-economy` exists to stop; the crewmate can read
 * the files itself, and it has tools to do so.
 */

import type { Check } from "../checks/schema.js";
import type { TriageRule } from "../contracts.js";

/** An orientation file the charter may point at, and what it is. */
export interface OrientationDoc {
  /** Repo-relative. The composition root stats exactly these. */
  readonly path: string;
  readonly note: string;
}

/** RED: the real candidate set lands with the implementation. */
export const ORIENTATION_DOCS: readonly OrientationDoc[] = [];

/** RED: derivation lands with the implementation. */
export function strictPathsFrom(_rules: readonly TriageRule[]): readonly string[] {
  return [];
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
    `- \`AGENTS.md\` — orientation, and the hard rules`,
    `- \`.sdd/architecture.md\` — how the engine is built (FCIS: \`core/\` is pure and must`,
    `  never import from \`shell/\`)`,
    `- \`.sdd/triage-rules.md\` — which discipline this change earns`,
    ``,
    `Read them from disk. They are not copied here on purpose — you have tools, and a`,
    `charter that inlines everything wastes the budget you need for the work.`,
    ``,
    `## What will gate your work`,
    ``,
  ];

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
    `These paths are STRICT TIER — full TDD, RED first, no exceptions:`,
  );
  for (const p of input.strictPaths) lines.push(`  - \`${p}\``);
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
