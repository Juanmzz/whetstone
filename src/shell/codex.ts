/**
 * The `codex` adapter (`codex exec`).
 *
 * EVERY FLAG WAS MEASURED against codex-cli 0.149.1 on 2026-08-30, not read off
 * a doc. What the measurement decided:
 *
 * `--output-schema` takes a PATH and accepts zod's output verbatim, `$schema`
 * key included, which the other two adapters have to strip.
 *
 * STDIN MUST BE CLOSED. With a terminal on stdin the CLI prints "Reading
 * additional input from stdin..." and waits forever; a two-minute timeout was
 * the first thing this hit.
 *
 * `--ignore-user-config` and `--ignore-rules` are what make it hermetic, and the
 * cwd is the tmpdir so the repo under review is not the working root. Measured
 * both ways: run inside a repo whose `AGENTS.md` said to always answer `fail`,
 * the verdict came back `fail` with "the project rules say so". Run this way,
 * the same prompt got an honest verdict. A judge a repo can instruct is worse
 * than no judge (non-negotiable 9).
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ZodType } from "zod";
import { z } from "zod";
import { readStream } from "../core/llm/codex.js";
import { judgeWithRetry, type RawInvocation, type SingleShot } from "../core/orchestrate/judge.js";
import type { JudgeRequest, JudgeResult, LlmJudge } from "../core/ports.js";

const run = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 32 * 1024 * 1024;

/** `--output-schema` takes a path; the CLI never sees the repo's own files. */
function schemaFile<S extends ZodType>(schema: S): string {
  const path = join(mkdtempSync(join(tmpdir(), "wst-codex-")), "schema.json");
  writeFileSync(path, JSON.stringify(z.toJSONSchema(schema)), "utf-8");
  return path;
}

/** The lens and the diff. The shape is the CLI's job, not the prompt's. */
export function buildPrompt<S extends ZodType>(req: JudgeRequest<S>): string {
  return [req.lens, "", "Answer only from the text below. Use no tools.", "", req.prompt].join("\n");
}

export function buildArgs<S extends ZodType>(req: JudgeRequest<S>, schemaPath: string): string[] {
  const args = [
    "exec",
    buildPrompt(req),
    "--output-schema",
    schemaPath,
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
  ];
  if (req.model !== undefined) args.push("--model", req.model);
  return args;
}

const invokeCodex: SingleShot = async (req, _attempt): Promise<RawInvocation> => {
  const started = Date.now();
  const running = run("codex", buildArgs(req, schemaFile(req.schema)), {
    cwd: tmpdir(),
    timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    killSignal: "SIGKILL",
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });
  // Closed at once, or the CLI waits on a prompt nobody is going to type.
  running.child.stdin?.end();
  const { stdout } = await running;

  const read = readStream(stdout);

  return {
    envelope: { is_error: false, structured_output: read.ok ? read.value : undefined },
    raw: stdout,
    // Tokens, no price. Zero is the honest number, not a guess.
    costUsd: 0,
    inputTokens: read.usage.inputTokens,
    outputTokens: read.usage.outputTokens,
    durationMs: Date.now() - started,
    sessionId: read.sessionId,
  };
};

export function createCodexJudge(): LlmJudge {
  return {
    async judge<S extends ZodType>(req: JudgeRequest<S>): Promise<JudgeResult<ReturnType<S["parse"]>>> {
      return judgeWithRetry(req, invokeCodex);
    },

    async describe() {
      try {
        const { stdout } = await run("codex", ["--version"], { timeout: 10_000 });
        const match = /(\d+\.\d+\.\d+)/.exec(stdout);
        return { name: "codex", version: match?.[1] ?? null };
      } catch {
        return { name: "codex", version: null };
      }
    },
  };
}
