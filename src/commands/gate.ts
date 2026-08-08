/**
 * `wst gate` — the composition root. Build the adapters, hand them to the pure
 * orchestrator, print, exit. **No decisions are made here**: which checks run, what
 * blocks, what earns a receipt and what the exit code is are all decided in
 * `src/core/gate/`, where the tests can reach them.
 *
 * Two things in this file are deliberately temporary, and both are marked in place:
 *
 *  1. **The triage seam.** `Routing` normally comes from `src/core/triage/`, which is
 *     being built in a parallel lane and does not exist yet. `provisionalRouting`
 *     stands in for it and fails SAFE — it assumes `strict`, the maximum tier, so the
 *     stub over-verifies rather than under-verifies. Replacing it is one import.
 *  2. **Two adapters living in a command.** `runShellCommand` and `unifiedDiff` spawn
 *     processes, which belongs in `src/shell/`. The gate lane does not own
 *     `src/shell/`, and the lane guard denies the write — correctly, since a second
 *     lane may be editing there. They are kept as thin as the rest of `src/shell/`
 *     is: no branching logic, all interpretation is in `core/gate/outcomes.ts`.
 */

import { exec, execFile } from "node:child_process";
import { join } from "node:path";
import type { LoadedCheck, Registry } from "../core/checks/registry.js";
import type { Tier } from "../core/checks/schema.js";
import type { CheckOutcome, Routing } from "../core/contracts.js";
import { aggregateChunkOutcomes, chunkDiff } from "../core/gate/chunk.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import { exitCodeFor, renderGateRun } from "../core/gate/report.js";
import {
  runGate as executeGate,
  type CheckRunner,
  type ReceiptStore,
} from "../core/gate/run.js";
import {
  LensVerdictSchema,
  interpretCommandResult,
  interpretJudgeResult,
  type CommandResult,
  type LensVerdict,
  type RunOutcome,
} from "../core/gate/outcomes.js";
import type { JudgeResult, LlmJudge } from "../core/ports.js";
import { createClaudeJudge } from "../shell/claude.js";
import { createGitAdapter } from "../shell/git.js";
import { readReceipt, writeReceipt } from "../shell/receipts.js";
import { loadRegistry } from "../shell/sdd.js";

export interface GateOptions {
  /** A `git diff` range. Default `HEAD` — the working tree against the last commit. */
  readonly range?: string;
  /** Provisional: overrides the stubbed triage tier until `core/triage/` lands. */
  readonly tier?: Tier;
  readonly json?: boolean;
  /** Per-lens spend ceiling handed to the judge. */
  readonly maxLensUsd?: number;
  readonly maxLensTotalUsd?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_RANGE = "HEAD";
const DEFAULT_MAX_LENS_USD = 0.5;
/** Total across all chunks, so a huge change cannot bill without bound. */
const DEFAULT_MAX_LENS_TOTAL_USD = 3;
/**
 * Per-chunk diff budget. Sized from measurement, not taste: a 5.3 KB single-file
 * diff cost ~$0.16 at opus, so ~24 KB sits comfortably inside the per-call cap
 * with headroom for a verbose reason.
 */
const LENS_CHUNK_BYTES = 24_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Exit code for a gate that could not even start. Distinct from a block. */
const EXIT_MISCONFIGURED = 2;

// ── the triage seam ──────────────────────────────────────────────────────────

/**
 * PROVISIONAL — replace with `route(classify(files, rules))` from `src/core/triage/`.
 *
 * It hard-codes the MAXIMUM tier rather than guessing. Triage's own rule is that the
 * tier is the maximum over the files touched and size only escalates, so a stub that
 * assumes `strict` can only ever run more checks than the real thing, never fewer.
 * A stub that guessed low would silently under-verify, and nobody would notice.
 */
function provisionalRouting(registry: Registry, tier: Tier): Routing {
  return {
    tier,
    checks: registry.active.filter((c) => c.tiers.includes(tier)).map((c) => c.id),
    autonomy: tier === "strict" ? "human-gate" : "autonomous",
    modelTier: "sonnet",
    autofix: false,
  };
}

// ── adapters (see the file header: these belong in src/shell/) ───────────────

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, signal: null, stdout, stderr });
          return;
        }

        // `code` is a NUMBER for a process that ran and exited non-zero, and a
        // STRING (ENOENT, EACCES, ...) when it never started. That distinction is
        // the whole of rule 1 at this boundary; `interpretCommandResult` decides
        // what it means, this only reports what was observed.
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

/** The unified diff for a set of paths — the payload an agent lens reviews. */
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

/**
 * One runner over both kinds of check. It only dispatches and reports; every
 * fail-versus-errored decision is made by `core/gate/outcomes.ts`.
 */
function createCheckRunner(deps: {
  readonly cwd: string;
  readonly range: string;
  readonly judge: LlmJudge;
  readonly routing: Routing;
  readonly maxLensUsd: number;
  readonly maxLensTotalUsd: number;
  readonly timeoutMs: number;
}): CheckRunner {
  return async (check: LoadedCheck, files: readonly ChangedFile[]): Promise<RunOutcome> => {
    if (check.kind === "deterministic") {
      if (check.command === undefined) {
        // Unreachable through the schema, which requires `command` for this kind.
        // Errored rather than thrown so a malformed registry entry degrades to
        // "this check did not run" instead of taking the whole gate down.
        return {
          outcome: { status: "errored", detail: `check "${check.id}" declares no command` },
        };
      }
      const result = await runShellCommand(check.command, deps.cwd, deps.timeoutMs);
      return { outcome: interpretCommandResult(result) };
    }

    if (check.review_lens === undefined) {
      return {
        outcome: { status: "errored", detail: `check "${check.id}" declares no review_lens` },
      };
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

    // CHUNKED, per sig-0023. One call carrying the whole diff cost $0.607 against a
    // $0.50 cap on a real 114 KB change and was killed, so the lens errored on every
    // strict-tier PR. The budget is now PER CHUNK, which is what makes it bounded:
    // a fixed total ceiling divided by an unknown number of files is just the same
    // failure with extra steps.
    const chunks = chunkDiff(diff, LENS_CHUNK_BYTES);
    if (chunks.length === 0) {
      return { outcome: { status: "skipped", reason: "not-in-tier" } };
    }

    const outcomes: CheckOutcome[] = [];
    let spent = 0;
    for (const chunk of chunks) {
      // A total ceiling still applies, so a 500-file change cannot bill without
      // bound. Remaining chunks are reported unjudged rather than silently dropped.
      if (spent >= deps.maxLensTotalUsd) {
        outcomes.push({
          status: "errored",
          detail: `total lens budget $${deps.maxLensTotalUsd} exhausted after ${outcomes.length} chunk(s)`,
        });
        continue;
      }
      const result = (await deps.judge.judge({
        lens: check.review_lens,
        prompt: `Review this diff.\n\n${chunk.diff}`,
        schema: LensVerdictSchema,
        model: deps.routing.modelTier,
        maxBudgetUsd: deps.maxLensUsd,
        timeoutMs: deps.timeoutMs,
      })) as JudgeResult<LensVerdict>;
      spent += result.costUsd;
      outcomes.push(interpretJudgeResult(result).outcome);
    }

    return { outcome: aggregateChunkOutcomes(outcomes) };
  };
}

// ── the command ──────────────────────────────────────────────────────────────

export async function runGate(
  opts: GateOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository — the gate reads a diff, so it needs one");
    return EXIT_MISCONFIGURED;
  }
  const sddRoot = join(repoRoot, ".sdd");
  const range = opts.range ?? DEFAULT_RANGE;

  let registry: Registry;
  try {
    registry = await loadRegistry(sddRoot);
  } catch (cause) {
    // A registry that will not load means an UNGATED change. It must be loud.
    console.error(`check registry failed to load\n  ${(cause as Error).message}`);
    return EXIT_MISCONFIGURED;
  }

  let files: ChangedFile[];
  try {
    files = parseNameStatus(await git.diffNameStatus(range));
  } catch (cause) {
    // `parseNameStatus` throws rather than dropping a line it cannot read, because
    // a dropped line is a file that silently went ungated.
    console.error(`could not read the diff for ${range}\n  ${(cause as Error).message}`);
    return EXIT_MISCONFIGURED;
  }

  const routing = provisionalRouting(registry, opts.tier ?? "strict");

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
        maxLensTotalUsd: opts.maxLensTotalUsd ?? DEFAULT_MAX_LENS_TOTAL_USD,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    },
  );

  if (opts.json === true) {
    console.log(JSON.stringify({ range, tier: routing.tier, ...run.verdict }, null, 2));
  } else {
    console.log(renderGateRun(run));
  }

  return exitCodeFor(run.verdict);
}
