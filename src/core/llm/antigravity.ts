/**
 * The `agy --output-format json` envelope. PURE.
 *
 * Shape captured from a live call rather than a doc, because the flags are not
 * documented. Two things it costs nothing to get wrong and everything to miss:
 * a cancelled run exits 0 with `response: ""`, and `response` carries keys the
 * schema forbade while `structured_output` does not.
 */

import type { JudgeError } from "./verdict.js";

export interface EnvelopeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export type EnvelopeRead =
  | { readonly ok: true; readonly value: unknown; readonly usage: EnvelopeUsage; readonly sessionId: string | null }
  | { readonly ok: false; readonly error: JudgeError; readonly usage: EnvelopeUsage; readonly sessionId: string | null };

const NO_USAGE: EnvelopeUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, durationMs: 0 });

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function readEnvelope(text: string): EnvelopeRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: "invalid-output", detail: "not JSON" }, usage: NO_USAGE, sessionId: null };
  }
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: { kind: "invalid-output", detail: "not an object" }, usage: NO_USAGE, sessionId: null };
  }

  const env = raw as Record<string, unknown>;
  const u = (env["usage"] ?? {}) as Record<string, unknown>;
  const usage: EnvelopeUsage = {
    inputTokens: num(u["input_tokens"]),
    outputTokens: num(u["output_tokens"]),
    durationMs: Math.round(num(env["duration_seconds"]) * 1000),
  };
  const sessionId = typeof env["conversation_id"] === "string" ? env["conversation_id"] : null;

  const status = env["status"];
  if (status !== "SUCCESS") {
    return {
      ok: false,
      error: { kind: "invalid-output", detail: `agy reported status ${String(status)}, so no verdict was produced` },
      usage,
      sessionId,
    };
  }

  const payload = env["structured_output"];
  if (payload === undefined || payload === null) {
    return {
      ok: false,
      error: { kind: "invalid-output", detail: "SUCCESS without structured_output" },
      usage,
      sessionId,
    };
  }

  return { ok: true, value: payload, usage, sessionId };
}
