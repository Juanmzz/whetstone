/**
 * `wst ready` — the command an implementation agent runs when it thinks it is done.
 *
 * The normal path takes NO ARGUMENTS. Resolving what to verify is the whole point:
 * an agent that has to be told a range gets told the wrong one, and a green report
 * over half a change is worse than no report. So it finds the repository, the
 * branch, the base and the merge base itself, and it says which of each it used.
 *
 * `--range` exists for CI and for diagnosing this resolution, and it is an
 * override rather than an argument: a human passing one is doing something
 * deliberate, and the report says the base came from `--range`.
 *
 * Composition root. Every decision it looks like it makes is in `core/ready/`.
 */

import { createGitAdapter } from "../shell/git.js";
import { readScopeFacts, mergeBaseOf, rangeFiles, taskFilesFrom } from "../shell/scope.js";
import { verifyRange } from "../shell/verify.js";
import { resolveBase } from "../core/ready/scope.js";
import { exitFor, readinessOf, saidAs, EXIT_INCOMPLETE } from "../core/ready/result.js";
import { firstMeaningfulLine, renderReady, type CheckLine, type ResultStatus } from "../core/ready/report.js";
import { outcomeOf } from "../core/gate/report.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";

export interface ReadyOptions {
  readonly json?: boolean;
  /**
   * An advanced override for CI and diagnostics. The normal path resolves its own
   * scope; a human passing a range here is doing something deliberate.
   */
  readonly range?: string;
  readonly fast?: boolean;
  readonly noEvidence?: boolean;
  /** Run llm checks too. Off by default: the pilot verifies deterministically. */
  readonly lens?: boolean;
}

const STATUS: Readonly<Record<string, ResultStatus>> = {
  pass: "pass",
  fail: "fail",
  errored: "errored",
  skipped: "skipped",
};

export async function runReady(
  opts: ReadyOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const began = Date.now();
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository: readiness is measured against a base, so it needs one");
    return EXIT_INCOMPLETE;
  }

  const scope = await readScopeFacts(cwd);
  const base = opts.range === undefined ? resolveBase(scope) : { ok: true as const, ref: opts.range, how: "--range" };
  if (!base.ok) {
    // Ambiguous scope is INCOMPLETE, never NOT_READY: nothing about the change was
    // judged, so calling it not ready would name the wrong problem.
    console.error(`\n  ${saidAs("INCOMPLETE")}\n\n  ${base.why}\n`);
    return EXIT_INCOMPLETE;
  }

  // A merge base that will not resolve means the scope was never established. Two
  // unrelated histories have none, and diffing against the ref anyway compares two
  // trees that share nothing: an enormous scope that would then be reported as
  // verified. `--range` is exempt because the caller said what they meant, and a
  // range like `a..b` is not a ref `merge-base` can take.
  let commit: string;
  if (opts.range !== undefined) {
    commit = opts.range;
  } else {
    const found = await mergeBaseOf(base.ref, cwd);
    if (found === null) {
      console.error(
        `\n  ${saidAs("INCOMPLETE")}\n\n  no merge base between HEAD and ${base.ref}, so the scope of this task is not established.\n  Pass --range to say what to verify.\n`,
      );
      return EXIT_INCOMPLETE;
    }
    commit = found;
  }

  // One diff against the merge base covers committed, staged and unstaged, because
  // a diff with no `..` compares the WORKING TREE to the ref. Untracked files are
  // invisible to it, and a check that never sees a new file reports on a change
  // that is not the one the agent made.
  let tracked: readonly ChangedFile[];
  try {
    tracked = parseNameStatus(await git.diffNameStatus(commit));
  } catch (cause) {
    console.error(`\n  ${saidAs("INCOMPLETE")}\n\n  could not read the diff against ${commit}\n  ${(cause as Error).message}\n`);
    return EXIT_INCOMPLETE;
  }
  const where =
    opts.range === undefined ? await taskFilesFrom(commit, cwd) : await rangeFiles(opts.range, cwd);
  const untracked = where.untracked.map((path): ChangedFile => ({ path, status: "added" }));
  const files = [...tracked, ...untracked];

  const verified = await verifyRange(
    {
      range: commit,
      files,
      json: opts.json ?? false,
      noLens: opts.lens !== true,
      noEvidence: opts.noEvidence ?? false,
      fast: opts.fast ?? false,
    },
    repoRoot,
    cwd,
  );
  if (!verified.ok) {
    console.error(`\n  ${saidAs("INCOMPLETE")}\n\n  ${verified.why}\n`);
    return EXIT_INCOMPLETE;
  }

  const { run, routing, registry } = verified;
  // An EMPTY registry is a gate that could not run, not an uncovered change.
  const outcome = registry.byId.size === 0 ? "incomplete" : outcomeOf(run.verdict, run.selection);
  const readiness = readinessOf(outcome, files.length > 0, {
    errored: run.verdict.errored,
    declined: run.selection.declined,
  });

  const results: CheckLine[] = run.verdict.results.map((r) => ({
    id: r.checkId,
    status: STATUS[r.outcome.status] ?? "n/a",
    ms: r.durationMs ?? 0,
    ...(r.outcome.status === "fail" || r.outcome.status === "errored"
      ? { detail: firstMeaningfulLine(r.outcome.detail ?? "") }
      : {}),
  }));

  const facts = {
    repo: repoRoot,
    branch: scope.branch ?? "(detached)",
    base: { ref: base.ref, how: base.how, commit: commit.slice(0, 8) },
    // Already relative to the repository root: that is what git prints, and what
    // every check's `include` glob is written against. Re-relativising them
    // against the process's cwd produced `../../home/...` the moment `ready` ran
    // from anywhere but the root.
    committed: where.committed,
    staged: where.staged,
    unstaged: where.unstaged,
    untracked: where.untracked,
    tier: routing.tier,
    applicable: run.selection.selected.map((s) => s.check.id),
    results,
    uncovered: run.selection.declined,
    evidence: [] as string[],
    elapsedMs: Date.now() - began,
    readiness,
  };

  if (opts.json === true) {
    // `result` is the field a consumer reads; `readiness` is the same value under
    // the name the renderer uses, and two names for one fact is one too many.
    const { readiness: _same, ...rest } = facts;
    console.log(JSON.stringify({ result: readiness, ...rest }, null, 2));
  } else {
    console.log(renderReady(facts));
  }
  return exitFor(readiness);
}
