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
export function branchNameFor(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `run/${slug === "" ? "task" : slug}`;
}
