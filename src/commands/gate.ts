/**
 * `wst gate` — the composition root. Build the adapters, hand them to the pure
 * orchestrator, print, exit. **No decisions are made here**: which checks run, what
 * blocks, what earns a receipt and what the exit code is are all decided in
 * `src/core/gate/`, where the tests can reach them.
 *
 * One thing in this file is deliberately temporary, and it is marked in place:
 * `runShellCommand` and `unifiedDiff` spawn processes, which belongs in
 * `src/shell/`. The gate lane does not own `src/shell/`, and the lane guard denies
 * the write — correctly, since a second lane may be editing there. They are kept as
 * thin as the rest of `src/shell/` is: no branching logic, all interpretation is in
 * `core/gate/outcomes.ts`.
 */

import { exec, execFile } from "node:child_process";
import { join } from "node:path";
import type { LoadedCheck, Registry } from "../core/checks/registry.js";
import type { Tier } from "../core/checks/schema.js";
import type { CheckOutcome, Routing } from "../core/contracts.js";
import { aggregateChunkOutcomes, chunkDiff } from "../core/gate/chunk.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import { exitCodeFor, renderGateRun } from "../core/gate/report.js";
import { dedupe, signalsFromGate } from "../core/signals/emit.js";
import { NULL_SINK } from "../core/events/record.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { appendSignals, readSignalLog } from "../shell/signals.js";
import { createEventLog, EVENTS_PATH, type EventLog } from "../shell/events.js";
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
import { classify, route } from "../core/triage/index.js";
import { createClaudeJudge } from "../shell/claude.js";
import { createGitAdapter } from "../shell/git.js";
import { readReceipt, writeReceipt } from "../shell/receipts.js";
import {
  loadRegistry,
  loadTriageRules,
  resolveDefinitionRoot,
  type LoadedTriageRules,
} from "../shell/sdd.js";

export interface GateOptions {
  /** A `git diff` range. Default `HEAD` — the working tree against the last commit. */
  readonly range?: string;
  /**
   * Force a tier instead of the one triage classified. An ESCAPE HATCH, not the
   * normal path: `.wst/triage.yaml` is where a project says what a change earns.
   * Kept because escalating by hand ("verify this as if it were strict") is a
   * legitimate thing to want, and because it is how the tier-specific behaviour
   * gets exercised without fabricating a diff.
   */
  readonly tier?: Tier;
  readonly json?: boolean;
  /** Per-lens spend ceiling handed to the judge. */
  readonly maxLensUsd?: number;
  readonly maxLensTotalUsd?: number;
  readonly timeoutMs?: number;
  /**
   * Skip agent-lens checks, reporting them as skipped rather than run.
   *
   * For the pre-push hook. A hook that costs 50 seconds and real money on every
   * push gets bypassed with --no-verify, and a routed-around gate has negative
   * value. Deterministic checks are fast and free, so they run every time; the
   * lens belongs where a human is not waiting on it.
   */
  readonly noLens?: boolean;
  /** Suppress signal emission. For dry runs and tests, not for normal use. */
  readonly noEmit?: boolean;
  /**
   * Ignore receipts entirely: skip nothing, record nothing.
   *
   * For a gate JUDGING SOMEONE ELSE'S WORK in their own working tree. Receipts are a
   * cache keyed on content, so honouring them is normally safe — but the file is
   * plain JSON that whoever produced the diff could write, and `parseReceipt`
   * validates its shape, not its provenance. A worker that mints the receipts its
   * own gate honours is one step from `charter.ts`'s "a worker that can merge its
   * own work has no gate".
   */
  readonly noReceipts?: boolean;
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

/** `--no-emit` means no log at all, so every drain has to tolerate its absence. */
const drain = (log: EventLog | null): Promise<string | null> =>
  log === null ? Promise.resolve(null) : log.drain();

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

function createReceiptStore(definitionRoot: string): ReceiptStore {
  return {
    read: (checkId) => readReceipt(definitionRoot, checkId),
    write: async (receipt) => {
      await writeReceipt(definitionRoot, receipt);
    },
  };
}

/**
 * A store that remembers nothing, for a gate that must not take the subject's word.
 *
 * Exported so `wst run` uses THIS rather than deciding for itself what "do not trust
 * the worker's cache" means — the same reason `createCheckRunner` is exported. Three
 * bugs in this codebase were one rule implemented twice and drifting.
 */
export function createDistrustfulReceiptStore(): ReceiptStore {
  return {
    read: async () => null,
    write: async () => undefined,
  };
}

/**
 * One runner over both kinds of check. It only dispatches and reports; every
 * fail-versus-errored decision is made by `core/gate/outcomes.ts`.
 */
/**
 * Exported so any second caller uses THIS runner instead of keeping a copy.
 *
 * `wst pr` kept one, and the copy silently missed the chunking and the total budget
 * cap added here for sig-0023 — the annotation reported every check unverified while
 * `wst gate` on the same range passed. That command is gone (ADR-0009) and the
 * export stays, because the lesson is not about `pr`: two implementations of "run a
 * check" is two places for the gate's honesty rules to drift apart.
 */
export function createCheckRunner(deps: {
  readonly cwd: string;
  readonly range: string;
  readonly judge: LlmJudge;
  readonly routing: Routing;
  readonly maxLensUsd: number;
  readonly maxLensTotalUsd: number;
  readonly noLens: boolean;
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

    if (deps.noLens) {
      // Reported as SKIPPED, never as passed. The change was not reviewed by this
      // check, and saying otherwise is the exact collapse the gate exists to stop.
      return { outcome: { status: "skipped", reason: "disabled" } };
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
  const range = opts.range ?? DEFAULT_RANGE;

  // Resolved on its own, ahead of everything else, because the event log lives
  // under it: a failure after this point can be RECORDED, and a failure before it
  // cannot be. That is the whole reason this is no longer one `try` with the
  // registry — the two config failures below used to vanish into stderr, and they
  // are exactly the runs where "the gate was broken, not the change" has to be
  // provable afterwards.
  let definitionRoot: string;
  try {
    definitionRoot = await resolveDefinitionRoot(repoRoot);
  } catch (cause) {
    console.error(`configuration failed to load\n  ${(cause as Error).message}`);
    return EXIT_MISCONFIGURED;
  }

  const startedAt = new Date();
  const events =
    opts.noEmit === true
      ? null
      : createEventLog(
          definitionRoot,
          `gate|${range}|${startedAt.toISOString()}`,
          () => new Date(),
        );
  const emit = events?.sink ?? NULL_SINK;
  emit({ kind: "run-started", detail: `wst gate --range ${range}` });

  const failed = async (detail: string, exit: number): Promise<number> => {
    emit({ kind: "run-failed", detail, exit });
    console.error(detail);
    await drain(events);
    return exit;
  };

  let registry: Registry;
  let rules: LoadedTriageRules;
  try {
    [registry, rules] = await Promise.all([
      loadRegistry(definitionRoot),
      loadTriageRules(definitionRoot),
    ]);
  } catch (cause) {
    // Configuration that will not load means an UNGATED change. It must be loud.
    // Triage rules belong in the same breath as the registry: rules the gate
    // could not read would silently route every change at the fallback tier.
    return await failed(
      `configuration failed to load\n  ${(cause as Error).message}`,
      EXIT_MISCONFIGURED,
    );
  }

  let files: ChangedFile[];
  try {
    files = parseNameStatus(await git.diffNameStatus(range));
  } catch (cause) {
    // `parseNameStatus` throws rather than dropping a line it cannot read, because
    // a dropped line is a file that silently went ungated.
    return await failed(
      `could not read the diff for ${range}\n  ${(cause as Error).message}`,
      EXIT_MISCONFIGURED,
    );
  }

  // The same two calls `wst pr` makes, deliberately. The gate is the enforcement
  // channel; if it routed from anything other than `.wst/triage.yaml`, the project's
  // triage rules would be decorative exactly where they matter, and the annotation
  // would describe a tier the gate never used.
  const triage = classify(files, rules.rules, rules.origin);
  const routing = route(opts.tier ?? triage.tier, registry.active);
  emit({
    kind: "triage-classified",
    detail: `${files.length} file(s) classified as ${routing.tier}`,
    tier: routing.tier,
  });

  const run = await executeGate(
    { routing, registry, files },
    {
      hashFile: (path) => git.hashFile(path),
      clock: { now: () => new Date() },
      events: emit,
      receipts:
        opts.noReceipts === true ? createDistrustfulReceiptStore() : createReceiptStore(definitionRoot),
      run: createCheckRunner({
        cwd: repoRoot,
        range,
        judge: createClaudeJudge(),
        routing,
        maxLensUsd: opts.maxLensUsd ?? DEFAULT_MAX_LENS_USD,
        maxLensTotalUsd: opts.maxLensTotalUsd ?? DEFAULT_MAX_LENS_TOTAL_USD,
        noLens: opts.noLens ?? false,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    },
  );

  // Record what the gate OBSERVED, before printing. Deduped against the log so
  // re-running while fixing a failure does not append the same signal five times:
  // the retro clusters on recurrence, and that would make "how often someone
  // re-ran the gate" look like evidence.
  //
  // Never let this fail the run. The gate's verdict is the product; the signal is
  // bookkeeping, and bookkeeping that can break a gate is worse than no bookkeeping.
  //
  // But SKIPPING must not be silent. Now that the log parser fails closed, the
  // likeliest thing thrown here is a corrupt line, and the two silent options are
  // both bad: emitting anyway means re-emitting every signal the unreadable log
  // already holds, and skipping quietly means the run that finally broke the build
  // leaves no trace, which is the one run whose evidence matters. So: skip, keep
  // the verdict, and tell the human — on stderr, and in the JSON for anything
  // reading this as an API. Losing one run's signal is recoverable by re-running
  // after a one-line fix; poisoning the retro's recurrence evidence is not.
  let emitted: string[] = [];
  let signalError: string | null = null;
  if (opts.noEmit !== true) {
    try {
      const candidates = signalsFromGate(run.verdict, range);
      // The branch is read HERE, from the same adapter that read the diff, so the
      // signal records the unit of work the verdict was actually about.
      emitted = await appendSignals(
        definitionRoot,
        dedupe(candidates, await readSignalLog(definitionRoot)),
        new Date(),
        await git.currentBranch(),
      );
    } catch (cause) {
      signalError = (cause as Error).message;
    }
  }

  const exit = exitCodeFor(run.verdict);
  emit({
    kind: "run-finished",
    // The verdict, plus what it was made of. A `block` line that does not name the
    // check that blocked sends the reader back to a console the run already lost.
    detail:
      run.verdict.verdict === "block"
        ? `blocked by ${run.verdict.blocking.join(", ")}`
        : `passed — ${run.verdict.results.length} check(s), ${run.verdict.errored.length} errored`,
    status: run.verdict.verdict,
    exit,
    ms: Math.max(0, Date.now() - startedAt.getTime()),
  });
  const eventError = await drain(events);

  if (opts.json === true) {
    console.log(
      JSON.stringify(
        { range, tier: routing.tier, emitted, signalError, run: events?.run ?? null, eventError, ...run.verdict },
        null,
        2,
      ),
    );
  } else {
    console.log(renderGateRun(run));
    if (emitted.length > 0) {
      console.log(`\n  signals emitted: ${emitted.join(", ")}`);
    }
    if (events !== null) {
      console.log(`  events: ${events.run} in ${DEFINITION_DIR}/${EVENTS_PATH}`);
    }
  }
  if (eventError !== null) {
    // Reported, never fatal, and never confused with the signal warning above: no
    // verdict is derived from this log, so a failure to write it costs a record and
    // nothing else.
    console.error(`\n  ⚠ the event log for this run is incomplete — ${eventError}`);
  }
  if (signalError !== null) {
    console.error(
      `\n  ⚠ no signals were recorded for this run — ${signalError}\n` +
        `    The verdict above still stands; only the bookkeeping was skipped.`,
    );
  }

  return exit;
}
