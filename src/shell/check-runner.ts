/**
 * Running one check: a command in a subprocess, or a lens through a judge.
 *
 * ONE runner over both kinds, and the reason is measured. `wst pr` kept a copy
 * that missed the chunking and the budget cap added for sig-0023, so it reported
 * every check unverified while `wst gate` on the same range passed. Every
 * fail-versus-errored decision is `core/gate/outcomes.ts`.
 */

export const DEFAULT_MAX_LENS_TOTAL_USD = 3;
import { exec, execFile } from "node:child_process";
import type { LoadedCheck } from "../core/checks/registry.js";
import type { CheckOutcome, Routing } from "../core/contracts.js";
import type { Agent } from "../core/config/schema.js";
import type { JudgeResult, LlmJudge } from "../core/ports.js";
import type { CheckRunner } from "../core/gate/run.js";
import { aggregateChunkOutcomes, chunkDiff } from "../core/gate/chunk.js";
import { checkEnv } from "../core/gate/env.js";
import {
  interpretCommandResult,
  interpretJudgeResult,
  LensVerdictSchema,
  type CheckRun,
  type CommandResult,
  type LensVerdict,
} from "../core/gate/outcomes.js";
import type { ChangedFile } from "../core/diff/parse.js";
import { gitEnv } from "./git.js";

/**
 * Per-chunk diff budget. Sized from measurement, not taste: a 5.3 KB single-file
 * diff cost ~$0.16 at opus, so ~24 KB sits comfortably inside the per-call cap
 * with headroom for a verbose reason.
 */
const LENS_CHUNK_BYTES = 24_000;
export const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 64 * 1024 * 1024;


function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  range?: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        // A check that binds a port must be able to tell one checkout from
        // another, or a server left running by one worktree gets reused by the
        // next and the gate passes against code it never read.
        env: checkEnv(process.env, cwd, range),
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        killSignal: "SIGKILL",
      },
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
      ["-c", "core.quotePath=false", "diff", range, "--", ...paths],
      // Same stripped environment as `shell/git.ts`, and the same `quotePath`: the
      // paths arrive unquoted from `diffNameStatus`, so git must be told not to
      // re-quote them in the `diff --git` headers the lens reads.
      { cwd, env: gitEnv(), maxBuffer: MAX_BUFFER },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
  });
}

export function createCheckRunner(deps: {
  readonly cwd: string;
  readonly range: string;
  /** The judge a check names, or the configured one when it names none. */
  readonly judgeFor: (agent: Agent | undefined) => LlmJudge;
  readonly routing: Routing;
  readonly maxLensUsd: number;
  readonly maxLensTotalUsd: number;
  readonly noLens: boolean;
  readonly timeoutMs: number;
}): CheckRunner {
  return async (check: LoadedCheck, files: readonly ChangedFile[]): Promise<CheckRun> => {
    if (check.kind === "deterministic") {
      if (check.command === undefined) {
        // Unreachable through the schema, which requires `command` for this kind.
        // Errored rather than thrown so a malformed registry entry degrades to
        // "this check did not run" instead of taking the whole gate down.
        return {
          outcome: { status: "errored", detail: `check "${check.id}" declares no command` },
        };
      }
      const result = await runShellCommand(check.command, deps.cwd, deps.timeoutMs, deps.range);
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
    // $0.50 cap on a real 114 KB change and was killed, so the lens errored on
    // every strict-tier PR.
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
      const result = (await deps.judgeFor(check.agent).judge({
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
