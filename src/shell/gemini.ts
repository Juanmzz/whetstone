/**
 * The Gemini adapter. Same port as `claude.ts`, three differences that matter.
 *
 * NO `--json-schema`. Gemini takes no schema flag, so the shape is asked for in the
 * prompt and validated on the way back. `judgeWithRetry` already retries an answer
 * that does not parse, which is the same loop, one layer later.
 *
 * NO SYSTEM PROMPT FLAG either, so the lens is folded into the prompt. A verdict
 * from here is therefore NOT comparable to one from `claude.ts`, and the receipt
 * binds a runtime for exactly that reason.
 *
 * HERMETIC BY ENV, not by flag. `GEMINI_CLI_HOME` moves `.gemini/` somewhere empty:
 * measured on 3.x, a user-level skill announced itself overriding a built-in one
 * during a plain `-p` call, which is `sig-0033` in another vendor. `--skip-trust` is
 * required rather than optional, because the neutral directory a hermetic judge runs
 * in can never be a trusted workspace.
 */

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import { z } from "zod";
import { judgeWithRetry, type RawInvocation, type SingleShot } from "../core/orchestrate/judge.js";
import type { JudgeRequest, JudgeResult, LlmJudge } from "../core/ports.js";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 32 * 1024 * 1024;

/** An empty home, so no user settings, skills or extensions reach the judge. */
const barrenHome = (): string => mkdtempSync(join(tmpdir(), "wst-gemini-home-"));

/** The lens, the shape, and the diff — in one prompt, because there is nowhere else. */
export function buildPrompt<S extends ZodType>(req: JudgeRequest<S>): string {
  const { $schema: _drop, ...shape } = z.toJSONSchema(req.schema) as Record<string, unknown>;
  return [
    req.lens,
    "",
    "Answer with a single JSON object and nothing else. No prose, no code fence.",
    "It must satisfy this JSON Schema:",
    JSON.stringify(shape),
    "",
    req.prompt,
  ].join("\n");
}

/** The first JSON object in a stream that may open with warnings on its own lines. */
export function firstJsonObject(text: string): unknown {
  const at = text.indexOf("{");
  if (at < 0) throw new Error(`no JSON in output: ${text.slice(0, 160)}`);
  return JSON.parse(text.slice(at));
}

/** The model's answer, which arrives as a STRING and may still wear a fence. */
export function parseResponse(response: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(response);
  return firstJsonObject(fenced?.[1] ?? response);
}

interface Tokens {
  readonly input: number;
  readonly output: number;
  readonly ms: number;
}

/** Summed across models: a single call routes through a utility model and a main one. */
export function tallyStats(stats: unknown): Tokens {
  const models = (stats as { models?: Record<string, unknown> } | null)?.models ?? {};
  let input = 0;
  let output = 0;
  let ms = 0;
  for (const entry of Object.values(models)) {
    const e = entry as { tokens?: Record<string, unknown>; api?: Record<string, unknown> };
    const num = (v: unknown): number => (typeof v === "number" ? v : 0);
    input += num(e.tokens?.["prompt"]);
    output += num(e.tokens?.["candidates"]);
    ms += num(e.api?.["totalLatencyMs"]);
  }
  return { input, output, ms };
}

const invokeGemini: SingleShot = async (req, _attempt): Promise<RawInvocation> => {
  const started = Date.now();
  const args = ["-p", buildPrompt(req), "--output-format", "json", "--skip-trust"];
  if (req.model !== undefined) args.push("--model", req.model);

  const { stdout } = await run("gemini", args, {
    // A NEUTRAL directory, and a home with nothing in it.
    cwd: tmpdir(),
    env: { ...process.env, GEMINI_CLI_HOME: barrenHome() },
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });

  const outer = firstJsonObject(stdout) as Record<string, unknown>;
  const response = outer["response"];
  const stats = tallyStats(outer["stats"]);

  // Normalised into the ONE envelope `interpretEnvelope` reads. A response that is
  // not JSON becomes an absent `structured_output`, which is a retry rather than a
  // verdict — the same treatment a schema violation gets from the other adapter.
  let structured: unknown;
  try {
    structured = typeof response === "string" ? parseResponse(response) : undefined;
  } catch {
    structured = undefined;
  }

  return {
    envelope: { is_error: false, structured_output: structured },
    raw: stdout,
    // Gemini reports tokens and no price. Zero is the honest number here, not a guess.
    costUsd: 0,
    inputTokens: stats.input,
    outputTokens: stats.output,
    durationMs: stats.ms || Date.now() - started,
    sessionId: typeof outer["session_id"] === "string" ? outer["session_id"] : null,
  };
};

export function createGeminiJudge(): LlmJudge {
  return {
    async judge<S extends ZodType>(
      req: JudgeRequest<S>,
    ): Promise<JudgeResult<ReturnType<S["parse"]>>> {
      return judgeWithRetry(req, invokeGemini);
    },

    async describe() {
      try {
        const { stdout } = await run("gemini", ["--version"], { timeout: 10_000 });
        const match = /(\d+\.\d+\.\d+)/.exec(stdout);
        return { name: "gemini", version: match?.[1] ?? null };
      } catch {
        return { name: "gemini", version: null };
      }
    },
  };
}
