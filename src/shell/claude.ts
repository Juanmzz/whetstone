/**
 * The `claude` adapter — the only place in Whetstone that spawns an LLM.
 *
 * THE FLAG SET IS LOAD-BEARING. Every flag below was measured against claude
 * v2.1.224; see `docs/architecture.md` for the evidence table. Do not "simplify" it.
 */

import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import { z } from "zod";
import { judgeWithRetry, type RawInvocation, type SingleShot } from "../core/orchestrate/judge.js";
import type { JudgeRequest, JudgeResult, LlmJudge } from "../core/ports.js";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * zod emits a `$schema` key pointing at the draft 2020-12 meta-schema URI, which
 * the CLI's validator rejects outright:
 *   "--json-schema is not a valid JSON Schema: no schema with key or ref
 *    https://json-schema.org/draft/2020-12/schema"
 * Strip it. Everything else zod produces is accepted as-is.
 */
function toClaudeJsonSchema(schema: ZodType): string {
  const { $schema: _discard, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
}

function buildArgs<S extends ZodType>(req: JudgeRequest<S>): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    toClaudeJsonSchema(req.schema),
    "--append-system-prompt",
    req.lens,
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    // Loads NO setting source at all. `--settings {hooks:{}}` only overrides the
    // PROJECT layer: measured on 2.1.226, the caller's `~/.claude/CLAUDE.md`, its
    // `rules/*.md` and its user-level SessionStart hooks all still fired, and one of
    // them injected a memory block carrying prompts from unrelated projects into a
    // verdict. See sig-0033.
    "--setting-sources",
    "",
    "--settings",
    '{"hooks":{},"outputStyle":"default"}',
    "--tools",
    "",
  ];
  if (req.model !== undefined) args.push("--model", req.model);
  if (req.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(req.maxBudgetUsd));
  return args;
}

const invokeClaude: SingleShot = async (req, _attempt): Promise<RawInvocation> => {
  const started = Date.now();
  const child = run("claude", buildArgs(req), {
    // A NEUTRAL directory, not the repo under review.
    cwd: tmpdir(),
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });

  child.child.stdin?.end(req.prompt);

  // The CLI exits NON-ZERO on its own terminal errors — notably
  // `error_max_budget_usd` — while still writing a complete, parseable envelope to
  // stdout. Measured: exit 1, stdout carries {is_error:true,
  // subtype:"error_max_budget_usd", total_cost_usd:0.607}.
  let stdout: string;
  try {
    ({ stdout } = await child);
  } catch (cause) {
    const partial = (cause as { stdout?: string }).stdout ?? "";
    try {
      JSON.parse(partial); // only trust it if it is actually a complete envelope
      stdout = partial;
    } catch {
      throw cause; // a genuine spawn failure — no envelope to classify from
    }
  }

  const envelope: unknown = JSON.parse(stdout);
  const e = envelope as Record<string, unknown>;
  const usage = (e["usage"] ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);

  return {
    envelope,
    raw: stdout,
    costUsd: num(e["total_cost_usd"]),
    inputTokens:
      num(usage["input_tokens"]) +
      num(usage["cache_creation_input_tokens"]) +
      num(usage["cache_read_input_tokens"]),
    outputTokens: num(usage["output_tokens"]),
    durationMs: num(e["duration_ms"]) || Date.now() - started,
    sessionId: typeof e["session_id"] === "string" ? e["session_id"] : null,
  };
};

export function createClaudeJudge(): LlmJudge {
  return {
    async judge<S extends ZodType>(
      req: JudgeRequest<S>,
    ): Promise<JudgeResult<ReturnType<S["parse"]>>> {
      return judgeWithRetry(req, invokeClaude);
    },

    async describe() {
      try {
        const { stdout } = await run("claude", ["--version"], { timeout: 10_000 });
        const match = /(\d+\.\d+\.\d+)/.exec(stdout);
        return { name: "claude", version: match?.[1] ?? null };
      } catch {
        return { name: "claude", version: null };
      }
    },
  };
}
