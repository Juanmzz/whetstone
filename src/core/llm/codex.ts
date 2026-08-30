/**
 * The `codex exec --json` event stream. PURE.
 *
 * JSONL, one event per line, and the verdict arrives as the text of an
 * `agent_message` item rather than as a field of its own. `--output-schema`
 * constrains that text to the schema, so it parses; when it does not, the run is
 * broken and not a verdict, which is the distinction hard rule 3 turns on.
 */

import type { JudgeError } from "./verdict.js";

export interface StreamUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export type StreamRead =
  | { readonly ok: true; readonly value: unknown; readonly usage: StreamUsage; readonly sessionId: string | null }
  | { readonly ok: false; readonly error: JudgeError; readonly usage: StreamUsage; readonly sessionId: string | null };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function events(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
    } catch {
      // The CLI prints its own lines to stdout. One of them is not a verdict.
    }
  }
  return out;
}

export function readStream(text: string): StreamRead {
  let usage: StreamUsage = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
  let sessionId: string | null = null;
  let message: string | null = null;

  for (const event of events(text)) {
    if (event["type"] === "thread.started" && typeof event["thread_id"] === "string") {
      sessionId = event["thread_id"];
    }
    if (event["type"] === "turn.completed") {
      const u = (event["usage"] ?? {}) as Record<string, unknown>;
      usage = { inputTokens: num(u["input_tokens"]), outputTokens: num(u["output_tokens"]), durationMs: 0 };
    }
    const item = (event["item"] ?? {}) as Record<string, unknown>;
    // LAST, not first: a turn may emit several, and the final one is the answer.
    if (item["type"] === "agent_message" && typeof item["text"] === "string") message = item["text"];
  }

  if (message === null) {
    return { ok: false, error: { kind: "invalid-output", detail: "no agent message" }, usage, sessionId };
  }
  try {
    return { ok: true, value: JSON.parse(message), usage, sessionId };
  } catch {
    return { ok: false, error: { kind: "invalid-output", detail: "the message is not JSON" }, usage, sessionId };
  }
}
