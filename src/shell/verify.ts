/**
 * Running the registry over a diff. The composition that `gate` and `ready` share.
 *
 * It lives here and not in `src/commands/` because a file there exports ONE thing
 * (adr-0037), and because two commands asking the same question must not answer it
 * with two engines. Nothing here decides: which checks run, what blocks, and what
 * the exit code is are all `src/core/gate/`.
 *
 * It RETURNS the verdict rather than printing it. `gate` renders its report and
 * emits signals; `ready` renders readiness and emits nothing. Neither can drift
 * from the other about what actually ran.
 */

import type { LoadedCheck, Registry } from "../core/checks/registry.js";
import type { Tier } from "../core/checks/schema.js";
import { parseNameStatus, type ChangedFile } from "../core/diff/parse.js";
import { progressLines, type ProgressTarget } from "../core/gate/progress.js";
import { startLive, type Live } from "./live.js";
import { createCheckRunner, DEFAULT_MAX_LENS_TOTAL_USD, DEFAULT_TIMEOUT_MS } from "./check-runner.js";
import { fastOnly } from "../core/gate/select.js";
import { answerableHere } from "../core/gate/environment.js";
import { runGate as executeGate, type CheckRunner, type GateRun } from "../core/gate/run.js";
import { classify, route } from "../core/triage/index.js";
import { resolveJudges } from "./judge.js";
import { createGitAdapter } from "./git.js";
import { createDistrustfulReceiptStore, createReceiptStore } from "./receipts.js";
import { loadRegistry, loadTriageRules, resolveDefinitionRoot, type LoadedTriageRules } from "./sdd.js";
import type { Routing } from "../core/contracts.js";

/** Per-lens ceiling. One definition now that two commands hand it to the runner. */
export const DEFAULT_MAX_LENS_USD = 0.5;

export interface VerifyOptions {
  readonly range: string;
  readonly tier?: Tier;
  readonly json?: boolean;
  readonly maxLensUsd?: number;
  readonly maxLensTotalUsd?: number;
  readonly timeoutMs?: number;
  readonly noLens?: boolean;
  readonly noEvidence?: boolean;
  readonly fast?: boolean;
  readonly noReceipts?: boolean;
  /**
   * The changed files, when the caller already resolved them.
   *
   * `gate` reads a range and lets git answer. `ready` resolves its own scope and
   * includes untracked files, which no diff reports, so it hands the set over
   * rather than asking for a range that cannot express it.
   */
  readonly files?: readonly ChangedFile[];
}

export interface Verified {
  readonly ok: true;
  readonly run: GateRun;
  readonly registry: Registry;
  readonly routing: Routing;
  readonly files: readonly ChangedFile[];
  readonly definitionRoot: string;
  readonly repoRoot: string;
}

/** Configuration or git could not be read. Never a verdict on the change. */
export interface NotVerified {
  readonly ok: false;
  readonly why: string;
}

/**
 * Prints each check as it starts and again as it finishes.
 *
 * STDERR, so it never mixes with `--json` on stdout and a caller piping the verdict
 * still sees the run is alive.
 */
function withProgress(
  runner: CheckRunner,
  target: ProgressTarget,
  live: Live,
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

export async function verifyRange(
  opts: VerifyOptions,
  repoRoot: string,
  cwd: string,
): Promise<Verified | NotVerified> {
  const git = createGitAdapter(cwd);
  const range = opts.range;

  // Resolved on its own, ahead of everything else, because the event log lives
  // under it: a failure after this point can be RECORDED, and a failure before it
  // cannot be.
  let definitionRoot: string;
  try {
    definitionRoot = await resolveDefinitionRoot(repoRoot);
  } catch (cause) {
    return { ok: false, why: `configuration failed to load\n  ${(cause as Error).message}` };
  }


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
    return { ok: false, why: `configuration failed to load\n  ${(cause as Error).message}` };
  }

  let files: readonly ChangedFile[];
  try {
    files = opts.files ?? parseNameStatus(await git.diffNameStatus(range));
  } catch (cause) {
    // `parseNameStatus` throws rather than dropping a line it cannot read, because
    // a dropped line is a file that silently went ungated.
    return { ok: false, why: `could not read the diff for ${range}\n  ${(cause as Error).message}` };
  }

  // Routed from `.wst/triage.yaml`, never from anything else. The gate is the
  // enforcement channel, so a gate routing from built-in defaults would make the
  // project's own triage rules decorative exactly where they matter.
  const triage = classify(files, rules.rules, rules.origin);
  // Routed from the subset, not filtered after: an excluded check never reaches
  // the verdict, so `--fast` reports what it ran.
  // Filtered where `--fast` filters, and for the same reason. An unselected check
  // is reported as excluded, never as passed.
  const runnable = registry.active.filter((check) =>
    answerableHere(check, { noEvidence: opts.noEvidence ?? false }),
  );
  const eligible = opts.fast === true ? fastOnly(runnable) : runnable;
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


  return { ok: true, run, registry, routing, files, definitionRoot, repoRoot };
}
