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
 *
 * That last sentence used to be a hope. `humanIsAtTheKeyboard` is where it becomes
 * a check: this layer is the one that can see a terminal, so it is the one that
 * decides whether the record may claim `source: "human"` at all.
 */

import { access } from "node:fs/promises";
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
 *
 * EXPORTED because `cli.ts` hands it to Commander as the flag's default, so the
 * help text and the fallback here cannot drift into two different answers. There
 * was a literal `"other"` in each place and nothing to notice when they diverged.
 */
export const DEFAULT_PHASE = "other";
/**
 * The middle of the scale. `high` is deliberately not the default: `clusterSignals`
 * treats a lone `high` as actionable on its own, so defaulting to it would let an
 * unconsidered flag drive a rule proposal by itself. Exported for the same reason
 * as `DEFAULT_PHASE`.
 */
export const DEFAULT_SEVERITY = "medium";

const EXIT_MISCONFIGURED = 2;
/** A rejected observation and a failed write both mean: nothing was recorded. */
const EXIT_NOT_RECORDED = 1;

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Evidence that a HUMAN typed this, which is the whole basis of `source: "human"`.
 *
 * It is a proxy, not a proof, and it is deliberately biased towards saying no: the
 * cost of a false yes is an agent's line entering the retro as first-class human
 * evidence, and the cost of a false no is one record labelled `cli` that still
 * carries every word the human wrote.
 */
function humanIsAtTheKeyboard(): boolean {
  // A crewmate is spawned with its stdin piped — `shell/crewmate.ts` writes the
  // charter into it — so it has no terminal. Neither does a hook or a CI job.
  if (process.stdin.isTTY !== true) return false;
  // And an agent running inside an interactive session INHERITS that terminal, so
  // a TTY alone evidences nothing. Claude Code marks its own subprocesses; this
  // also downgrades a human typing `!wst signal` from inside a session, which is
  // the direction to be wrong in.
  return process.env["CLAUDECODE"] === undefined;
}

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
      ruleAffected: opts.rule ?? [],
      // From git, never from the task name or a ticket id. An inferred branch is a
      // guess wearing the costume of a fact, and the retro would group work that
      // never shared one.
      branch: await git.currentBranch(),
      attested: humanIsAtTheKeyboard(),
    },
    new Date(),
  );

  if (!result.ok) {
    console.error("nothing was written — the observation is not yet a signal:");
    for (const error of result.errors) console.error(`  · ${error}`);
    return EXIT_NOT_RECORDED;
  }

  const line = JSON.stringify(result.record);
  if (opts.dryRun === true) {
    console.log(line);
    return 0;
  }

  // `.sdd/` must already be there. `appendSignalRecord` creates its parents, so
  // without this check an uninitialised repo gets a fabricated memory tree and a
  // success message — and every other command that touches `.sdd/` calls that
  // misconfigured and exits 2. It gets worse downstream: `core/init/plan.ts` plans
  // this exact path, so the stray file makes `wst init` refuse to bootstrap, and
  // `init --force` overwrites it, deleting the human's only copy of what they saw.
  const sddRoot = join(repoRoot, ".sdd");
  if (!(await exists(sddRoot))) {
    console.error(`no .sdd/ in ${repoRoot} — run \`wst init\` first`);
    console.error("the observation, so it is not lost:");
    console.log(line);
    return EXIT_MISCONFIGURED;
  }

  let path: string;
  try {
    path = await appendSignalRecord(sddRoot, result.record);
  } catch (cause) {
    // The human typed this at the moment they had the thought. A raw stack trace
    // that also loses the words is the worst possible answer to a full disk or a
    // read-only checkout, so: one line of cause, and the record on stdout where a
    // redirect or a paste can still save it.
    console.error(`could not write the signal: ${(cause as Error).message}`);
    console.error("the observation, so it is not lost — append this line to .sdd/memory/signals.jsonl:");
    console.log(line);
    return EXIT_NOT_RECORDED;
  }
  console.log(`recorded ${result.record.id} in ${path}`);
  if (result.record.source !== "human") {
    // Not an error, and not silent either. `source` is the log's only provenance
    // distinction and the retro weighs it; the person reading this deserves to
    // know their record did not claim to be theirs.
    console.log("  recorded as `cli`, not `human`: no terminal evidenced who typed it");
  }
  if (result.record.rule_affected?.length === 0) {
    // Not an error. [RC7] allows an empty list and the retro will try to classify
    // it — but a signal that names the rule it implicates is the one that turns
    // into an amendment, so it is worth one line to say so.
    console.log("  no --rule given: the retro will have to guess which rule this implicates");
  }
  return 0;
}
