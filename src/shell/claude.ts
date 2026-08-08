/**
 * The `claude` adapter — the only place in Whetstone that spawns an LLM.
 *
 * THE FLAG SET IS LOAD-BEARING. Every flag below was measured against claude
 * v2.1.224; see `.sdd/architecture.md` for the evidence table. Do not "simplify" it:
 *
 *  - `--strict-mcp-config --mcp-config {}` + `--settings {hooks:{}}` make the call
 *    HERMETIC. Without them the child inherits the caller's MCP servers, plugins and
 *    SessionStart hooks: measured at 140,682 input tokens / $0.84 for a one-word
 *    answer, versus ~11.4k / $0.03-0.08 hermetic. This is the frugality thesis.
 *  - `--append-system-prompt`, never `--system-prompt`. Replacing the system prompt
 *    made the model leak tool-call markup into schema-valid fields.
 *  - NOT `--bare`: it forces ANTHROPIC_API_KEY and never reads OAuth, which would
 *    bill separately and lose the subscription cost advantage.
 *  - Prompt on stdin — diffs exceed argv limits.
 */

import { execFile } from "node:child_process";
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
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });

  child.child.stdin?.end(req.prompt);
  const { stdout } = await child;

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
