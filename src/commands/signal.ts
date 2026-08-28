/**
 * `wst signal` — a human records an observation, at the moment they have it.
 */

import { access } from "node:fs/promises";
import { exists } from "../shell/fs.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { resolveDefinitionRoot } from "../shell/sdd.js";
import { readFile } from "node:fs/promises";
import { readForeignFindings } from "../core/signals/foreign.js";
import { DEFAULT_PHASE, DEFAULT_SEVERITY, humanSignal } from "../core/signals/human.js";
import { createGitAdapter } from "../shell/git.js";
import { resolveMemory } from "../shell/memory.js";

export interface SignalOptions {
  readonly type: string;
  readonly detail: string;
  // Both are required by the command line and supplied by the batch instead
  // when `--from-json` is given.
  readonly phase?: string;
  readonly severity?: string;
  readonly rule?: readonly string[];
  /** Print the line that would be appended, write nothing. */
  readonly dryRun?: boolean;
  /** A file of findings from another tool, or `-` for stdin. */
  readonly fromJson?: string;
  /** Which tool found them, named in each record so a reader can re-run it. */
  readonly tool?: string;
}


const EXIT_MISCONFIGURED = 2;
/** A rejected observation and a failed write both mean: nothing was recorded. */
const EXIT_NOT_RECORDED = 1;

/**
 * Evidence that a HUMAN typed this, which is the whole basis of `source: "human"`.
 *
 * It is a proxy, not a proof, and it is deliberately biased towards saying no: the
 * cost of a false yes is an agent's line entering the retro as first-class human
 * evidence, and the cost of a false no is one record labelled `cli` that still
 * carries every word the human wrote.
 */
function humanIsAtTheKeyboard(): boolean {
  // A crewmate spawned headless has its stdin piped — that is how a charter reaches
  // it — so it has no terminal. Neither does a hook or a CI job.
  if (process.stdin.isTTY !== true) return false;
  // And an agent running inside an interactive session INHERITS that terminal, so
  // a TTY alone evidences nothing. Claude Code marks its own subprocesses; this
  // also downgrades a human typing `!wst signal` from inside a session, which is
  // the direction to be wrong in.
  return process.env["CLAUDECODE"] === undefined;
}


/**
 * A batch from another tool. The human gate does not move: a person runs this,
 * and every record is written `source: "cli"` because nobody typed the words.
 */
async function runForeign(
  path: string,
  opts: SignalOptions,
  repoRoot: string,
  cwd: string,
): Promise<number> {
  let text: string;
  try {
    text = path === "-" ? await readStdin() : await readFile(path, "utf-8");
  } catch (cause) {
    console.error(`could not read ${path}: ${(cause as Error).message}`);
    return EXIT_MISCONFIGURED;
  }

  const read = readForeignFindings(text, opts.tool);
  if (!read.ok) {
    console.error(`nothing was written. ${String(read.errors.length)} problem(s):`);
    for (const problem of read.errors) console.error(`  ${problem}`);
    return EXIT_NOT_RECORDED;
  }

  const records = read.findings.map((f) => humanSignal(f, new Date()));
  const lines = records.flatMap((r) => (r.ok ? [r.record] : []));

  if (opts.dryRun === true) {
    for (const record of lines) console.log(JSON.stringify(record));
    return 0;
  }

  let root: string;
  try {
    root = await resolveDefinitionRoot(repoRoot);
    if (!(await exists(root))) throw new Error(`no ${DEFINITION_DIR}/ in ${repoRoot}`);
  } catch (cause) {
    console.error((cause as Error).message);
    for (const record of lines) console.log(JSON.stringify(record));
    return EXIT_MISCONFIGURED;
  }

  try {
    await (await resolveMemory(root)).save(lines);
  } catch (cause) {
    console.error(`could not write: ${(cause as Error).message}`);
    console.error("the findings, so they are not lost:");
    for (const record of lines) console.log(JSON.stringify(record));
    return EXIT_NOT_RECORDED;
  }

  void cwd;
  console.log(`recorded ${String(lines.length)} finding(s) in ${DEFINITION_DIR}/memory/signals.jsonl`);
  console.log("  source: cli, because a tool found these and nobody typed them.");
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function runSignal(
  opts: SignalOptions,
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository: the signal log lives in one, so it needs one");
    return EXIT_MISCONFIGURED;
  }

  if (opts.fromJson !== undefined) {
    return await runForeign(opts.fromJson, opts, repoRoot, cwd);
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
    console.error("nothing was written, the observation is not yet a signal:");
    for (const error of result.errors) console.error(`  · ${error}`);
    return EXIT_NOT_RECORDED;
  }

  const line = JSON.stringify(result.record);
  if (opts.dryRun === true) {
    console.log(line);
    return 0;
  }

  // `.wst/` must already be there. A repo still holding the OLD directory gets the
  // migration message rather than "run `wst init` first" (ADR-0012).
  let root: string;
  try {
    root = await resolveDefinitionRoot(repoRoot);
    if (!(await exists(root))) {
      throw new Error(`no ${DEFINITION_DIR}/ in ${repoRoot}: run \`wst init\` first`);
    }
  } catch (cause) {
    console.error((cause as Error).message);
    console.error("the observation, so it is not lost:");
    console.log(line);
    return EXIT_MISCONFIGURED;
  }

  try {
    await (await resolveMemory(root)).save([result.record]);
  } catch (cause) {
    // The human typed this at the moment they had the thought. A raw stack trace
    // that also loses the words is the worst possible answer to a full disk or a
    // read-only checkout, so: one line of cause, and the record on stdout where a
    // redirect or a paste can still save it.
    console.error(`could not write the signal: ${(cause as Error).message}`);
    console.error(
      `the observation, so it is not lost. Append this line to ${DEFINITION_DIR}/memory/signals.jsonl:`,
    );
    console.log(line);
    return EXIT_NOT_RECORDED;
  }
  console.log(`recorded ${result.record.id} in ${DEFINITION_DIR}/memory/signals.jsonl`);
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
