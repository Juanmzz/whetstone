/**
 * The Antigravity adapter (`agy`), which supersedes `gemini.ts` for anyone
 * without a Code Assist Standard or Enterprise licence.
 *
 * Every flag here was read off `agy --help` and every field off a live call,
 * because Google documents neither. What the measurement changed:
 *
 * `--json-schema` EXISTS, unlike Gemini, so the shape is enforced by the CLI
 * rather than asked for in prose. The parsed object arrives in
 * `structured_output`; `response` holds prose plus a JSON blob that carried
 * keys the schema had forbidden, so it is never read.
 *
 * `--sandbox` IS REQUIRED, not optional. Without it the agent reaches for a
 * tool, headless cannot prompt for the permission, and the run is auto-denied
 * and returns `status: CANCELED` with an empty response and EXIT CODE 0.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import { z } from "zod";
import { readEnvelope } from "../core/llm/antigravity.js";
import { judgeWithRetry, type RawInvocation, type SingleShot } from "../core/orchestrate/judge.js";
import type { JudgeRequest, JudgeResult, LlmJudge } from "../core/ports.js";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 32 * 1024 * 1024;

/** `--json-schema` takes a path; the CLI never sees the repo's own files. */
function schemaFile<S extends ZodType>(schema: S): string {
  const { $schema: _drop, ...shape } = z.toJSONSchema(schema) as Record<string, unknown>;
  const path = join(mkdtempSync(join(tmpdir(), "wst-agy-")), "schema.json");
  writeFileSync(path, JSON.stringify(shape), "utf-8");
  return path;
}

/** The lens and the diff. The shape is the CLI's job, not the prompt's. */
export function buildPrompt<S extends ZodType>(req: JudgeRequest<S>): string {
  return [
    req.lens,
    "",
    "Answer only from the text below. Use no tools.",
    "",
    req.prompt,
  ].join("\n");
}

const invokeAgy: SingleShot = async (req, _attempt): Promise<RawInvocation> => {
  const started = Date.now();
  const args = [
    "-p",
    buildPrompt(req),
    "--output-format",
    "json",
    "--json-schema",
    schemaFile(req.schema),
    "--sandbox",
  ];
  if (req.model !== undefined) args.push("--model", req.model);

  const { stdout } = await run("agy", args, {
    cwd: tmpdir(),
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });

  const read = readEnvelope(stdout);

  return {
    // An unread envelope becomes an absent `structured_output`, which the retry
    // loop treats as a retry rather than a verdict.
    envelope: { is_error: false, structured_output: read.ok ? read.value : undefined },
    raw: stdout,
    // Tokens, no price. Zero is the honest number, not a guess.
    costUsd: 0,
    inputTokens: read.usage.inputTokens,
    outputTokens: read.usage.outputTokens,
    durationMs: read.usage.durationMs || Date.now() - started,
    sessionId: read.sessionId,
  };
};

export function createAntigravityJudge(): LlmJudge {
  return {
    async judge<S extends ZodType>(
      req: JudgeRequest<S>,
    ): Promise<JudgeResult<ReturnType<S["parse"]>>> {
      return judgeWithRetry(req, invokeAgy);
    },

    async describe() {
      try {
        const { stdout } = await run("agy", ["--version"], { timeout: 10_000 });
        const match = /(\d+\.\d+\.\d+)/.exec(stdout);
        return { name: "antigravity", version: match?.[1] ?? null };
      } catch {
        return { name: "antigravity", version: null };
      }
    },
  };
}
