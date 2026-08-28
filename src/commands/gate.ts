/**
 * `wst gate` — the composition root. Build the adapters, hand them to the pure
 * orchestrator, print, exit. **No decisions are made here**: which checks run, what
 * blocks, what earns a receipt and what the exit code is are all decided in
 * `src/core/gate/`, where the tests can reach them.
 */

import { exec, execFile } from "node:child_process";
import { join } from "node:path";
import type { LoadedCheck, Registry } from "../core/checks/registry.js";
import type { Tier } from "../core/checks/schema.js";
import type { CheckOutcome, Routing } from "../core/contracts.js";
import { aggregateChunkOutcomes, chunkDiff } from "../core/gate/chunk.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import { EXIT_INCOMPLETE, exitCodeFor, renderGateRun } from "../core/gate/report.js";
import { progressLines, type ProgressTarget } from "../core/gate/progress.js";
import { startLive, type Live } from "../shell/live.js";
import {
  createCheckRunner,
  DEFAULT_MAX_LENS_TOTAL_USD,
  DEFAULT_TIMEOUT_MS,
} from "../shell/check-runner.js";
import { dedupe, signalsFromGate } from "../core/signals/emit.js";
import { appendSignals } from "../shell/signals.js";
import { resolveMemory } from "../shell/memory.js";
import { checkEnv } from "../core/gate/env.js";
import { fastOnly } from "../core/gate/select.js";
import { runGate as executeGate, type CheckRunner } from "../core/gate/run.js";
import {
  LensVerdictSchema,
  interpretCommandResult,
  interpretJudgeResult,
  type CommandResult,
  type LensVerdict,
  type CheckRun,
} from "../core/gate/outcomes.js";
import type { Agent } from "../core/config/schema.js";
import type { JudgeResult, LlmJudge } from "../core/ports.js";
import { classify, route } from "../core/triage/index.js";
import { resolveJudges } from "../shell/judge.js";
import { createGitAdapter, gitEnv } from "../shell/git.js";
import { createDistrustfulReceiptStore, createReceiptStore } from "../shell/receipts.js";
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
   * Skip llm checks, reporting them as skipped rather than run.
   *
   * For the pre-push hook. A hook that costs 50 seconds and real money on every
   * push gets bypassed with --no-verify, and a routed-around gate has negative
   * value. Deterministic checks are fast and free, so they run every time; the
   * lens belongs where a human is not waiting on it.
   */
  readonly noLens?: boolean;
  /** Run only the checks that can answer while somebody is waiting. */
  readonly fast?: boolean;
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
/** Exit code for a gate that could not even start. Distinct from a block. */
const EXIT_MISCONFIGURED = 2;


// ── the command ──────────────────────────────────────────────────────────────


/**
 * Prints each check as it starts and again as it finishes.
 *
 * Written to STDERR so it never mixes with `--json` on stdout, and so a caller
 * piping the verdict still sees the run is alive. `--json` silences it anyway:
 * a machine reading the envelope has no use for progress.
 */
function withProgress(
  runner: CheckRunner,
  target: ProgressTarget,
  live: Live,
  /** A check the runner will skip without work. Announcing it is noise. */
  willSkip: (check: LoadedCheck) => boolean = () => false,
): CheckRunner {
  return async (check, files) => {
    if (willSkip(check)) return runner(check, files);

    const began = Date.now();
    live.add(check.id);
    const outcome = await runner(check, files);
    const [line] = progressLines(
      { phase: "finished", checkId: check.id, status: outcome.outcome.status, ms: Date.now() - began },
      target,
    );
    live.done(check.id, line ?? "");
    return outcome;
  };
}

export async function runGate(
  opts: GateOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository: the gate reads a diff, so it needs one");
    return EXIT_MISCONFIGURED;
  }
  const range = opts.range ?? DEFAULT_RANGE;

  // Resolved on its own, ahead of everything else, because the event log lives
  // under it: a failure after this point can be RECORDED, and a failure before it
  // cannot be.
  let definitionRoot: string;
  try {
    definitionRoot = await resolveDefinitionRoot(repoRoot);
  } catch (cause) {
    console.error(`configuration failed to load\n  ${(cause as Error).message}`);
    return EXIT_MISCONFIGURED;
  }


  const failed = (detail: string, exit: number): number => {
    console.error(detail);
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

  // Routed from `.wst/triage.yaml`, never from anything else. The gate is the
  // enforcement channel, so a gate routing from built-in defaults would make the
  // project's own triage rules decorative exactly where they matter.
  const triage = classify(files, rules.rules, rules.origin);
  // Routed from the subset, not filtered after: an excluded check never reaches
  // the verdict, so `--fast` reports what it ran.
  const eligible = opts.fast === true ? fastOnly(registry.active) : registry.active;
  const routing = route(opts.tier ?? triage.tier, eligible);

  // ONE line for however many checks are in flight, closed whatever happens: an
  // interval left running holds an animation over the report it is under.
  const live = startLive(process.stderr, opts.json === true);
  const run = await executeGate(
    { routing, registry, files },
    {
      hashFile: (path) => git.hashFile(path),
      clock: { now: () => new Date() },
      receipts:
        opts.noReceipts === true ? createDistrustfulReceiptStore() : createReceiptStore(definitionRoot),
      // Wrapped, not plumbed through `GatePorts`: `check-started` is deliberately
      // absent from the event schema, and that reasoning still holds — the need is
      // the reader's, not the log's. This channel is in-process and reaches no file.
      runCheck: withProgress(createCheckRunner({
        cwd: repoRoot,
        range,
        judgeFor: await resolveJudges(definitionRoot),
        routing,
        maxLensUsd: opts.maxLensUsd ?? DEFAULT_MAX_LENS_USD,
        maxLensTotalUsd: opts.maxLensTotalUsd ?? DEFAULT_MAX_LENS_TOTAL_USD,
        noLens: opts.noLens ?? false,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
      opts.json === true ? { quiet: true } : {},
      live,
      // `--no-lens` skips every llm check without work. Announcing `running` and
      // then `skipped (0ms)` for it is the gate narrating something it did not do.
      (check) => opts.noLens === true && check.kind === "llm"),
    },
  ).finally(() => {
    live.close();
  });

  // Bookkeeping must never fail the run, and must never fail QUIETLY: emitting
  // over an unreadable log re-emits everything it holds, and skipping in silence
  // loses the evidence of the run that finally broke the build.
  let emitted: string[] = [];
  let signalError: string | null = null;
  if (opts.noEmit !== true) {
    try {
      const candidates = signalsFromGate(run.verdict, range);
      // The branch is read HERE, from the same adapter that read the diff, so the
      // signal records the unit of work the verdict was actually about.
      emitted = await appendSignals(
        definitionRoot,
        dedupe(candidates, await (await resolveMemory(definitionRoot)).all()),
        new Date(),
        await git.currentBranch(),
      );
    } catch (cause) {
      signalError = (cause as Error).message;
    }
  }

  // A repo with an EMPTY registry is not an uncovered change — it is a gate that
  // could not run, and adr-0021 unblocks the first case only. `wst init` is the
  // remedy, and it is a remedy, which is the test that separates the two.
  const exit = registry.byId.size === 0 ? EXIT_INCOMPLETE : exitCodeFor(run.verdict, run.selection);


  if (opts.json === true) {
    console.log(
      JSON.stringify(
        { range, tier: routing.tier, emitted, signalError, ...run.verdict },
        null,
        2,
      ),
    );
  } else {
    console.log(renderGateRun(run));
    if (emitted.length > 0) {
      console.log(`\n  signals emitted: ${emitted.join(", ")}`);
    }
  }
  if (signalError !== null) {
    console.error(
      `\n  ⚠ no signals were recorded for this run: ${signalError}\n` +
        `    The verdict above still stands; only the bookkeeping was skipped.`,
    );
  }

  return exit;
}
