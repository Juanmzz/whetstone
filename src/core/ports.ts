/**
 * The ports. Every effect the engine needs, expressed as an interface the pure
 * core can depend on. Adapters live in `src/shell/`.
 *
 * `src/core/**` must never import from `src/shell/**` — enforced by
 * `test/architecture.test.ts`. Orchestrators in `src/core/orchestrate/` receive
 * these as PARAMETERS, which is how sequencing and retry policy stay testable
 * instead of leaking into `src/commands/`.
 */

import type { ZodType } from "zod";
import type { JudgeError } from "./llm/verdict.js";

export interface GitPort {
  /** Repository root, or null when not inside a work tree. */
  repoRoot(): Promise<string | null>;
  currentBranch(): Promise<string | null>;
  /** Raw `git diff --name-status <range>` output, for `core/diff/parse`. */
  diffNameStatus(range: string): Promise<string>;
  /** Content hash of a path at HEAD — the input to a receipt. */
  hashFile(path: string): Promise<string>;
}

export interface ClockPort {
  now(): Date;
}

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface JudgeRequest<S extends ZodType> {
  /** Appended to the system prompt — never replaces it (see architecture.md). */
  readonly lens: string;
  /** The user-turn content. Delivered on stdin: diffs exceed argv limits. */
  readonly prompt: string;
  /** Runtime contract AND compile-time type — the two cannot drift apart. */
  readonly schema: S;
  readonly model?: ModelTier;
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
}

export interface Attempt {
  readonly n: number;
  readonly outcome: "accept" | "retry" | "fail";
  readonly reason?: string;
  readonly costUsd: number;
  readonly durationMs: number;
}

export interface JudgeMeta {
  /** Every attempt made. The calibration harness reads this. */
  readonly attempts: readonly Attempt[];
  /** Raw text of the final envelope, kept for receipts and debugging. */
  readonly raw: string;
  /** Summed across ALL attempts — retries are not free. */
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly sessionId: string | null;
}

/**
 * A discriminated union on `ok`, so a caller that checks it gets `value` narrowed
 * without a non-null assertion. The gate must never be able to read a verdict that
 * was not actually produced.
 */
export type JudgeResult<T> =
  | ({ readonly ok: true; readonly value: T; readonly error?: undefined } & JudgeMeta)
  | ({ readonly ok: false; readonly value?: undefined; readonly error: JudgeError } & JudgeMeta);

/**
 * The ONE boundary that may call an LLM. Model-agnostic by construction: adding a
 * provider means adding an adapter behind this port, with zero core changes.
 */
export interface LlmJudge {
  judge<S extends ZodType>(req: JudgeRequest<S>): Promise<JudgeResult<ReturnType<S["parse"]>>>;
  /** Version of the underlying CLI/model runtime, for drift detection. */
  describe(): Promise<{ readonly name: string; readonly version: string | null }>;
}
