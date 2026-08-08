/**
 * `wst pr` — the composition root for Layer 5. Build the adapters, run the gate,
 * annotate, post. **No decisions are made here**: what is red, what the body says,
 * whether a comment is a duplicate and whether to request changes are all decided in
 * `src/core/annotate/`, where the tests can reach them.
 *
 * Exit codes are about the ANNOTATION, not about the change:
 *
 *   0  the PR was annotated (or, with `--dry-run`, would have been)
 *   1  the annotation could not be produced or posted
 *
 * It deliberately does NOT exit non-zero on `REQUEST_CHANGES`. `wst gate` already
 * owns that channel and does it properly (0 pass · 1 blocked · 2 a block-severity
 * check never ran); a second command answering the same question with a different
 * rule is how two sources of truth get born. Use `wst gate` in CI.
 *
 * ## One piece of knowing duplication, marked so it is not mistaken for a design
 *
 * `runShellCommand` / `unifiedDiff` / `provisionalRouting`'s replacement are lifted
 * from `src/commands/gate.ts`, because that file exports only an exit code — the
 * annotation needs the whole `GateRun` (the verdict AND the per-check coverage from
 * `selection`). The fix is one line in a file this lane does not own: `gate.ts`
 * should export `executeGateRun(opts): Promise<GateRun>` and both commands should
 * call it. Flagged to the orchestrator rather than worked around silently.
 */

import { exec, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  annotate,
  inlineComments,
  pruneAlreadyPosted,
  renderBody,
  reviewSummary,
  shouldPostReview,
  upsertManagedBlock,
  writeProse,
  type Annotation,
  type CheckCoverage,
} from "../core/annotate/index.js";
import type { LoadedCheck, Registry } from "../core/checks/registry.js";
import type { Routing, TriageResult, TriageRule } from "../core/contracts.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import {
  LensVerdictSchema,
  interpretCommandResult,
  interpretJudgeResult,
  type CommandResult,
  type LensVerdict,
  type RunOutcome,
} from "../core/gate/outcomes.js";
import { runGate as executeGate, type CheckRunner, type ReceiptStore } from "../core/gate/run.js";
import type { JudgeResult, LlmJudge } from "../core/ports.js";
import { classify, DEFAULT_RULES, parseTriageRules, route } from "../core/triage/index.js";
import { createClaudeJudge } from "../shell/claude.js";
import { createGitAdapter } from "../shell/git.js";
import { createGithubAdapter, type GithubPort } from "../shell/github.js";
import { readReceipt, writeReceipt } from "../shell/receipts.js";
import { loadRegistry } from "../shell/sdd.js";

export interface PrOptions {
  /** `git diff --name-status <range>`. Defaults to the PR's own commits vs the base. */
  readonly range?: string;
  /** Base branch for a PR that does not exist yet. */
  readonly base?: string;
  readonly title?: string;
  /** Print exactly what WOULD be posted, spend nothing, touch no PR. */
  readonly dryRun?: boolean;
  /** Skip the LLM prose. The engine's reasons always stand on their own. */
  readonly noLlm?: boolean;
  /** Create the PR if the branch has none. Off by default — opening a PR is the human's call. */
  readonly create?: boolean;
  readonly maxProseUsd?: number;
  readonly maxLensUsd?: number;
  readonly timeoutMs?: number;
  readonly json?: boolean;
}

const DEFAULT_BASE = "main";
const DEFAULT_MAX_PROSE_USD = 0.25;
const DEFAULT_MAX_LENS_USD = 0.5;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 64 * 1024 * 1024;

const EXIT_OK = 0;
const EXIT_FAILED = 1;

// ── adapters lifted from gate.ts (see the file header) ───────────────────────

function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, signal: null, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          exitCode: typeof code === "number" ? code : null,
          signal: error.signal ?? null,
          stdout,
          stderr,
          ...(typeof code === "string" ? { spawnError: `${code}: ${error.message}` } : {}),
          ...(error.killed === true ? { timedOut: true } : {}),
        });
      },
    );
  });
}

function unifiedDiff(range: string, paths: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["diff", range, "--", ...paths],
      { cwd, maxBuffer: MAX_BUFFER },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
  });
}

function createReceiptStore(sddRoot: string): ReceiptStore {
  return {
    read: (checkId) => readReceipt(sddRoot, checkId),
    write: async (receipt) => {
      await writeReceipt(sddRoot, receipt);
    },
  };
}

function createCheckRunner(deps: {
  readonly cwd: string;
  readonly range: string;
  readonly judge: LlmJudge;
  readonly routing: Routing;
  readonly maxLensUsd: number;
  readonly timeoutMs: number;
}): CheckRunner {
  return async (check: LoadedCheck, files: readonly ChangedFile[]): Promise<RunOutcome> => {
    if (check.kind === "deterministic") {
      if (check.command === undefined) {
        return { outcome: { status: "errored", detail: `check "${check.id}" declares no command` } };
      }
      return { outcome: interpretCommandResult(await runShellCommand(check.command, deps.cwd, deps.timeoutMs)) };
    }

    if (check.review_lens === undefined) {
      return { outcome: { status: "errored", detail: `check "${check.id}" declares no review_lens` } };
    }

    let diff: string;
    try {
      diff = await unifiedDiff(deps.range, files.map((f) => f.path), deps.cwd);
    } catch (cause) {
      return {
        outcome: {
          status: "errored",
          detail: `could not read the diff for ${check.id}: ${(cause as Error).message}`,
        },
      };
    }

    const result = (await deps.judge.judge({
      lens: check.review_lens,
      prompt: `Review this diff.\n\n${diff}`,
      schema: LensVerdictSchema,
      model: deps.routing.modelTier,
      maxBudgetUsd: deps.maxLensUsd,
      timeoutMs: deps.timeoutMs,
    })) as JudgeResult<LensVerdict>;

    return interpretJudgeResult(result);
  };
}

async function loadRules(sddRoot: string): Promise<{ rules: readonly TriageRule[]; origin: string }> {
  const path = join(sddRoot, "triage.yaml");
  try {
    return { rules: parseTriageRules(await readFile(path, "utf-8"), path), origin: path };
  } catch (cause) {
    // Only a MISSING file falls back. A malformed one is re-thrown by
    // `parseTriageRules` and must not be swallowed — silently ignoring rules
    // somebody wrote is how a change gets triaged at the wrong discipline.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { rules: DEFAULT_RULES, origin: "built-in defaults" };
    }
    throw cause;
  }
}

// ── the dry run ──────────────────────────────────────────────────────────────

function printDryRun(
  annotation: Annotation,
  body: string,
  comments: readonly { path: string; line?: number; body: string }[],
  summary: { event: string; body: string },
  target: string,
): void {
  console.log(`wst pr — DRY RUN. Nothing was posted.\n`);
  console.log(`  target        ${target}`);
  console.log(`  event         ${summary.event}`);
  console.log(
    `  criticality   ${String(annotation.counts.review)} review · ${String(annotation.counts.skim)} skim · ${String(annotation.counts.skip)} skip`,
  );
  console.log(`  comments      ${String(comments.length)} inline (🔴 only)\n`);
  console.log("--- PR body (managed block) ---");
  console.log(body);
  console.log("--- review ---");
  console.log(summary.body);
  for (const comment of comments) {
    console.log(
      `\n--- inline comment · ${comment.path}${comment.line === undefined ? " (file-level)" : `:${String(comment.line)}`} ---`,
    );
    console.log(comment.body);
  }
}

// ── the command ──────────────────────────────────────────────────────────────

export async function runPr(opts: PrOptions = {}, cwd: string = process.cwd()): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository — `wst pr` annotates a diff, so it needs one");
    return EXIT_FAILED;
  }

  const branch = await git.currentBranch();
  if (branch === null) {
    console.error("HEAD is detached — check out a branch before annotating a PR");
    return EXIT_FAILED;
  }

  const sddRoot = join(repoRoot, ".sdd");
  const base = opts.base ?? DEFAULT_BASE;
  const range = opts.range ?? `${base}...HEAD`;

  let registry: Registry;
  let rules: { rules: readonly TriageRule[]; origin: string };
  try {
    [registry, rules] = await Promise.all([loadRegistry(sddRoot), loadRules(sddRoot)]);
  } catch (cause) {
    console.error(`configuration failed to load\n  ${(cause as Error).message}`);
    return EXIT_FAILED;
  }

  let files: ChangedFile[];
  try {
    files = parseNameStatus(await git.diffNameStatus(range));
  } catch (cause) {
    console.error(`could not read the diff for ${range}\n  ${(cause as Error).message}`);
    return EXIT_FAILED;
  }

  const triage: TriageResult = classify(files, rules.rules, rules.origin);
  const routing = route(triage.tier, registry.active);

  const run = await executeGate(
    { routing, registry, files },
    {
      hashFile: (path) => git.hashFile(path),
      clock: { now: () => new Date() },
      receipts: createReceiptStore(sddRoot),
      run: createCheckRunner({
        cwd: repoRoot,
        range,
        judge: createClaudeJudge(),
        routing,
        maxLensUsd: opts.maxLensUsd ?? DEFAULT_MAX_LENS_USD,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    },
  );

  // The coverage seam: which files each check actually looked at. Without it a
  // finding cannot be attributed to a file, and the annotation degenerates into a
  // list of check names.
  const coverage: CheckCoverage[] = run.selection.selected.map((selected) => ({
    checkId: selected.check.id,
    paths: selected.files.map((file) => file.path),
  }));

  const annotation = annotate({ triage, verdict: run.verdict, coverage });

  // The LLM writes ONE thing: "look here because X", for 🔴 only. Zero red files
  // means zero calls (see `prose.ts`).
  let prose = new Map<string, string>();
  let proseCost = 0;
  if (opts.noLlm !== true) {
    let diff = "";
    try {
      diff = await unifiedDiff(
        range,
        annotation.files.filter((f) => f.criticality === "review").map((f) => f.path),
        repoRoot,
      );
    } catch {
      diff = "";
    }

    const written = await writeProse(
      {
        annotation,
        ...(diff.trim() !== "" ? { diff } : {}),
        model: routing.modelTier,
        maxBudgetUsd: opts.maxProseUsd ?? DEFAULT_MAX_PROSE_USD,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      },
      createClaudeJudge(),
    );
    prose = new Map(written.prose);
    proseCost = written.costUsd;
    if (written.error !== undefined) {
      // Reported, never fatal. The engine already wrote a reason for every file.
      console.error(`  (no LLM prose: ${written.error})`);
    }
  }

  const body = renderBody(annotation, { prose, range });
  const summary = reviewSummary(annotation);
  const allComments = inlineComments(annotation, prose);

  if (opts.json === true) {
    console.log(
      JSON.stringify(
        { range, tier: triage.tier, annotation, costUsd: run.verdict.totalCostUsd + proseCost },
        null,
        2,
      ),
    );
  }

  const github: GithubPort = createGithubAdapter(repoRoot);

  if (opts.dryRun === true) {
    // Dry run does not talk to GitHub at all, so it cannot prune — it prints every
    // comment it would consider, which is the honest thing to show.
    if (opts.json !== true) printDryRun(annotation, body, allComments, summary, `${branch} -> ${base}`);
    return EXIT_OK;
  }

  if (!(await github.available())) {
    console.error("`gh` is not available or not authenticated — run `gh auth login`");
    return EXIT_FAILED;
  }

  try {
    let pr = await github.findPr(branch);
    if (pr === null) {
      if (opts.create !== true) {
        console.error(
          `no pull request for \`${branch}\`. Open one, or re-run with --create.\n` +
            `  (--dry-run prints the annotation without needing a PR at all)`,
        );
        return EXIT_FAILED;
      }
      pr = await github.createPr({
        title: opts.title ?? branch,
        body: upsertManagedBlock("", body),
        head: branch,
        base,
      });
      console.log(`  created  ${pr.url}`);
    } else {
      // Replace the managed block; the author's own prose is preserved byte-for-byte.
      await github.setPrBody(pr.number, upsertManagedBlock(pr.body, body));
      console.log(`  body     updated on ${pr.url}`);
    }

    const [postedComments, postedReviews] = await Promise.all([
      github.listReviewComments(pr.number),
      github.listReviews(pr.number),
    ]);

    const fresh = pruneAlreadyPosted(allComments, postedComments);
    const reviewIsNew = shouldPostReview(summary.digest, postedReviews);

    if (!reviewIsNew && fresh.length === 0) {
      console.log("  review   already up to date — nothing to post");
      return EXIT_OK;
    }

    await github.postReview(pr.number, {
      event: annotation.event,
      body: summary.body,
      comments: fresh,
      commitId: pr.headSha,
    });

    console.log(
      `  review   ${annotation.event} · ${String(fresh.length)} new inline comment(s)` +
        `${allComments.length - fresh.length > 0 ? ` (${String(allComments.length - fresh.length)} already posted)` : ""}`,
    );
    if (proseCost > 0) console.log(`  cost     $${proseCost.toFixed(4)} (annotation prose)`);
    return EXIT_OK;
  } catch (cause) {
    console.error(`could not annotate the PR\n  ${(cause as Error).message}`);
    return EXIT_FAILED;
  }
}
