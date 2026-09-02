/**
 * Where a raw result becomes a `CheckOutcome`. PURE.
 *
 *   the check ran and said no        -> `fail`    -> may block, if severity allows
 *   the check could not run at all   -> `errored` -> NEVER blocks
 */

import { z } from "zod";
import type { CheckOutcome } from "../contracts.js";
import type { JudgeResult } from "../ports.js";

/**
 * What an `llm` check must return. `reason` is mandatory and non-empty: an
 * unexplained verdict cannot be reviewed, argued with, or turned into a signal.
 */
export const LensVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().min(1),
});

export type LensVerdict = z.infer<typeof LensVerdictSchema>;

/** What running one check produced. `skipped` is not reachable here — only the gate skips. */
export interface CheckRun {
  readonly outcome: CheckOutcome;
  /** Only set by llm checks. Deterministic ones are free. */
  readonly costUsd?: number;
}

/** The raw exit status of a deterministic check's command, as an adapter observed it. */
export interface CommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not be started at all (ENOENT, EACCES, ...). */
  readonly spawnError?: string;
  readonly timedOut?: boolean;
}

const MAX_DETAIL = 2000;

/**
 * Keep the TAIL. Compilers and test runners put the summary last, and a detail
 * truncated from the end throws away the only line a human wants.
 */
function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_DETAIL ? trimmed : `…${trimmed.slice(-MAX_DETAIL)}`;
}

function output(result: CommandResult): string {
  return tail([result.stdout, result.stderr].filter((s) => s.trim() !== "").join("\n"));
}

/**
 * The package manager's echo of the script it is about to run, dropped.
 *
 * npm prints `> pkg@1.0.0 lint` and `> eslint .` before anything happens, so on a
 * missing binary those two lines arrive ahead of the one that says WHAT is missing.
 * Only for a run that could not START: a check that really failed owns every line
 * of its output, and trimming there would hide part of a verdict.
 */
function withoutScriptEcho(printed: string): string {
  const kept = printed
    .split("\n")
    .filter((line) => !/^\s*>\s/.test(line))
    .join("\n")
    .trim();
  return kept === "" ? printed : kept;
}

export function interpretCommandResult(result: CommandResult): CheckOutcome {
  // Order matters, and every branch above the exit code is deliberate: a broken run
  // often ALSO reports a non-zero exit, and reading the code first would turn a
  // timeout or a missing binary into a blocking "failure".
  if (result.spawnError !== undefined && result.spawnError !== "") {
    return { status: "errored", detail: `could not run the check: ${result.spawnError}` };
  }
  if (result.timedOut === true) {
    return { status: "errored", detail: `the check timed out${signalSuffix(result.signal)}` };
  }
  if (result.signal !== null) {
    return { status: "errored", detail: `the check was killed by ${result.signal}` };
  }
  if (result.exitCode === null) {
    return {
      status: "errored",
      detail: "the check produced no exit status: nothing was observed to pass or fail",
    };
  }

  if (result.exitCode === 0) return { status: "pass" };

  // A deterministic check runs through a shell, so a missing or non-executable
  // binary never reaches us as a spawn error — the shell starts fine and exits 127
  // / 126. The line stops here deliberately: 128+N (killed by signal N) is NOT
  // included, because unlike 126/127 it is not reserved and real tools return codes
  // in that range.
  if (result.exitCode === 126 || result.exitCode === 127) {
    const why = result.exitCode === 127 ? "command not found" : "command not executable";
    const printed = withoutScriptEcho(output(result));
    return {
      status: "errored",
      detail: `the check could not be run (${why}, exit ${result.exitCode})${
        printed === "" ? "" : `: ${printed}`
      }`,
    };
  }

  const detail = output(result);
  return {
    status: "fail",
    detail: detail === "" ? `exited with code ${result.exitCode}` : detail,
  };
}

function signalSuffix(signal: string | null): string {
  return signal === null ? "" : ` (killed by ${signal})`;
}

export function interpretJudgeResult(result: JudgeResult<LensVerdict>): CheckRun {
  if (!result.ok) {
    // EVERY JudgeError lands here, `invalid-output` included. A model that cannot
    // produce a parseable verdict has not found a bug — it has failed to answer,
    // and an unanswered question must never block someone's change.
    return {
      outcome: {
        status: "errored",
        detail: `the review lens produced no usable verdict (${result.error.kind}): ${result.error.detail}`,
      },
      costUsd: result.costUsd,
    };
  }

  return {
    outcome:
      result.value.verdict === "pass"
        ? { status: "pass" }
        : { status: "fail", detail: result.value.reason },
    costUsd: result.costUsd,
  };
}
