/**
 * `wst signal` — a human records an observation, at the moment they have it.
 *
 * A composition root, nothing more: read the branch from git, hand the observation
 * to `core/signals/human.ts`, write what comes back. Every decision about what a
 * valid signal is lives there, where the tests can reach it.
 *
 * **This is the only command that may write to memory, and the reason is narrow:**
 * the human typed it, which IS [RC3]'s human gate (`.sdd/skills/recording.md`).
 * Nothing else inherits that. An agent that thinks it has spotted a signal still
 * proposes it and waits — including an agent that could technically run this
 * command, since a gate discharged by "an agent ran the human's tool" is not a gate.
 */

import { join } from "node:path";
import { humanSignal } from "../core/signals/human.js";
import { createGitAdapter } from "../shell/git.js";
import { appendSignalRecord } from "../shell/signals.js";

export interface SignalOptions {
  readonly type: string;
  readonly detail: string;
  readonly phase?: string;
  readonly severity?: string;
  readonly rule?: readonly string[];
  /** Print the line that would be appended, write nothing. */
  readonly dryRun?: boolean;
}

/**
 * `other` is in the spec's vocabulary and is the honest answer when nobody said.
 * Guessing a phase would put a fabricated fact in a permanent record to save one
 * flag.
 */
const DEFAULT_PHASE = "other";
/**
 * The middle of the scale. `high` is deliberately not the default: `clusterSignals`
 * treats a lone `high` as actionable on its own, so defaulting to it would let an
 * unconsidered flag drive a rule proposal by itself.
 */
const DEFAULT_SEVERITY = "medium";

const EXIT_MISCONFIGURED = 2;

export async function runSignal(
  opts: SignalOptions,
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository — the signal log lives in one, so it needs one");
    return EXIT_MISCONFIGURED;
  }

  const result = humanSignal(
    {
      type: opts.type,
      phase: opts.phase ?? DEFAULT_PHASE,
      severity: opts.severity ?? DEFAULT_SEVERITY,
      detail: opts.detail,
      ruleAffected: (opts.rule ?? []).map((r) => r.trim()).filter((r) => r !== ""),
      // From git, never from the task name or a ticket id. An inferred branch is a
      // guess wearing the costume of a fact, and the retro would group work that
      // never shared one.
      branch: await git.currentBranch(),
    },
    new Date(),
  );

  if (!result.ok) {
    console.error("nothing was written — the observation is not yet a signal:");
    for (const error of result.errors) console.error(`  · ${error}`);
    return 1;
  }

  const line = JSON.stringify(result.record);
  if (opts.dryRun === true) {
    console.log(line);
    return 0;
  }

  const path = await appendSignalRecord(join(repoRoot, ".sdd"), result.record);
  console.log(`recorded ${result.record.id} in ${path}`);
  if (result.record.rule_affected?.length === 0) {
    // Not an error. [RC7] allows an empty list and the retro will try to classify
    // it — but a signal that names the rule it implicates is the one that turns
    // into an amendment, so it is worth one line to say so.
    console.log("  no --rule given: the retro will have to guess which rule this implicates");
  }
  return 0;
}
