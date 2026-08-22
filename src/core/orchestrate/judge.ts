/**
 * Retry policy for the LLM boundary. PURE — it drives an injected invoker rather
 * than spawning anything itself.
 *
 * This tier exists on purpose. `core/` may not do I/O and `shell/` must stay a thin
 * adapter, so without it the retry loop would land in `src/commands/`, which no test
 * guards. Orchestrators take ports as PARAMETERS: the policy stays in the tested core.
 */

import type { ZodType } from "zod";
import { interpretEnvelope, type JudgeError } from "../llm/verdict.js";
import type { Attempt, JudgeRequest, JudgeResult } from "../ports.js";

export interface RawInvocation {
  readonly envelope: unknown;
  readonly raw: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly sessionId: string | null;
}

export type SingleShot = <S extends ZodType>(
  req: JudgeRequest<S>,
  attempt: number,
) => Promise<RawInvocation>;

const DEFAULT_MAX_ATTEMPTS = 3;

export async function judgeWithRetry<S extends ZodType>(
  req: JudgeRequest<S>,
  invoke: SingleShot,
): Promise<JudgeResult<ReturnType<S["parse"]>>> {
  const maxAttempts = req.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attempts: Attempt[] = [];

  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let durationMs = 0;
  let raw = "";
  let sessionId: string | null = null;

  const meta = () => ({
    attempts,
    raw,
    costUsd,
    inputTokens,
    outputTokens,
    durationMs,
    sessionId,
  });

  const succeed = (value: ReturnType<S["parse"]>): JudgeResult<ReturnType<S["parse"]>> => ({
    ok: true,
    value,
    ...meta(),
  });

  const failWith = (error: JudgeError): JudgeResult<ReturnType<S["parse"]>> => ({
    ok: false,
    error,
    ...meta(),
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (req.signal?.aborted === true) {
      return failWith({
        kind: "timeout",
        detail: "aborted by caller before invocation",
      });
    }

    let shot: RawInvocation;
    try {
      shot = await invoke(req, attempt);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      // A binary that is not there will not be there next time. Anything else is
      // the process failing to start once, which says nothing about the lens.
      const terminal =
        (cause as { code?: unknown }).code === "ENOENT" || attempt >= maxAttempts;
      attempts.push({ n: attempt, outcome: terminal ? "fail" : "retry", reason: detail, costUsd: 0, durationMs: 0 });
      if (terminal) return failWith({ kind: "spawn", detail });
      continue;
    }

    // Retries are not free — meter every attempt, not just the last.
    costUsd += shot.costUsd;
    inputTokens += shot.inputTokens;
    outputTokens += shot.outputTokens;
    durationMs += shot.durationMs;
    raw = shot.raw;
    sessionId = shot.sessionId;

    const outcome = interpretEnvelope(shot.envelope, req.schema, { attempt, maxAttempts });

    if (outcome.kind === "accept") {
      attempts.push({
        n: attempt,
        outcome: "accept",
        costUsd: shot.costUsd,
        durationMs: shot.durationMs,
      });
      return succeed(outcome.value as ReturnType<S["parse"]>);
    }

    if (outcome.kind === "retry") {
      attempts.push({
        n: attempt,
        outcome: "retry",
        reason: outcome.reason,
        costUsd: shot.costUsd,
        durationMs: shot.durationMs,
      });
      continue;
    }

    attempts.push({
      n: attempt,
      outcome: "fail",
      reason: outcome.error.detail,
      costUsd: shot.costUsd,
      durationMs: shot.durationMs,
    });
    return failWith(outcome.error);
  }

  return failWith({
    kind: "invalid-output",
    detail: `no valid verdict after ${maxAttempts} attempts`,
  });
}
