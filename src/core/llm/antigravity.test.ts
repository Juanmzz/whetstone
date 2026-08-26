import { describe, expect, it } from "vitest";
import { readEnvelope } from "./antigravity.js";

const SUCCESS = JSON.stringify({
  conversation_id: "8d16859e",
  status: "SUCCESS",
  response: '**Verdict:** Pass\n{"reason":"r","toolAction":"Completing task","verdict":"pass"}\n',
  duration_seconds: 2.7031558369999997,
  num_turns: 2,
  structured_output: { verdict: "pass", reason: "renames a local variable" },
  json_schema: {},
  usage: { input_tokens: 29897, output_tokens: 174, thinking_tokens: 103, total_tokens: 30071 },
});

const CANCELED = JSON.stringify({
  conversation_id: "8d16859e",
  status: "CANCELED",
  response: "",
  duration_seconds: 1.79,
  num_turns: 1,
  json_schema: {},
  usage: { input_tokens: 14127, output_tokens: 168, total_tokens: 14295 },
});

describe("readEnvelope", () => {
  it("takes the payload from structured_output", () => {
    const read = readEnvelope(SUCCESS);

    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toEqual({ verdict: "pass", reason: "renames a local variable" });
  });

  it("never takes it from response, which carries keys the schema forbade", () => {
    // Measured: with additionalProperties false, `response` still came back with
    // toolAction and toolSummary in it. Only structured_output is the schema's.
    const read = readEnvelope(SUCCESS);

    expect(read.ok && JSON.stringify(read.value)).not.toMatch(/toolAction/);
  });

  it("refuses a CANCELED run rather than reading its empty response", () => {
    // The trap this module exists for: agy exits 0 on a cancelled run, and
    // `response` is "". A reader that trusts the exit code publishes silence
    // as a verdict, which hard rule 3 forbids.
    const read = readEnvelope(CANCELED);

    expect(read.ok).toBe(false);
    expect(read.ok === false && read.error.kind).toBe("invalid-output");
    expect(read.ok === false && read.error.detail).toMatch(/CANCELED/);
  });

  it("refuses a SUCCESS that carries no structured_output", () => {
    const missing = JSON.stringify({ status: "SUCCESS", response: "prose only", usage: {} });

    expect(readEnvelope(missing).ok).toBe(false);
  });

  it("refuses text that is not an envelope at all", () => {
    expect(readEnvelope("not json").ok).toBe(false);
    expect(readEnvelope("").ok).toBe(false);
  });

  it("reports the tokens the run actually spent, on success and on refusal alike", () => {
    // A cancelled run still burned 14k input tokens. Reporting zero for it
    // makes a retry loop look free.
    expect(readEnvelope(SUCCESS).usage.inputTokens).toBe(29897);
    expect(readEnvelope(CANCELED).usage.inputTokens).toBe(14127);
  });

  it("reads the duration in milliseconds, because seconds are the CLI's unit and not ours", () => {
    expect(readEnvelope(SUCCESS).usage.durationMs).toBe(2703);
  });

  it("carries the conversation id through, and null when there is none", () => {
    expect(readEnvelope(SUCCESS).sessionId).toBe("8d16859e");
    expect(readEnvelope("not json").sessionId).toBeNull();
  });
});
