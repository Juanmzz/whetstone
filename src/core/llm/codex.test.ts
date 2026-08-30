import { describe, expect, it } from "vitest";
import { readStream } from "./codex.js";

const line = (o: unknown): string => JSON.stringify(o);

const STREAM = [
  line({ type: "thread.started", thread_id: "01a0503e-6d27-7880-b0ff-cf904e407dc6" }),
  line({ type: "turn.started" }),
  line({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: '{"verdict":"pass","reason":"it adds a test"}' } }),
  line({ type: "turn.completed", usage: { input_tokens: 13971, cached_input_tokens: 0, output_tokens: 30 } }),
].join("\n");

describe("readStream", () => {
  it("reads the verdict, the tokens and the thread from one live capture", () => {
    // Captured from `codex exec --json` on codex-cli 0.149.1, not from a doc.
    const read = readStream(STREAM);

    expect(read.ok).toBe(true);
    expect(read.ok && read.value).toEqual({ verdict: "pass", reason: "it adds a test" });
    expect(read.usage).toEqual({ inputTokens: 13971, outputTokens: 30, durationMs: 0 });
    expect(read.sessionId).toBe("01a0503e-6d27-7880-b0ff-cf904e407dc6");
  });

  it("takes the LAST agent message, since a turn may produce several", () => {
    const two = [
      line({ type: "item.completed", item: { type: "agent_message", text: '{"verdict":"fail","reason":"a"}' } }),
      line({ type: "item.completed", item: { type: "agent_message", text: '{"verdict":"pass","reason":"b"}' } }),
    ].join("\n");
    const read = readStream(two);
    expect(read.ok && read.value).toEqual({ verdict: "pass", reason: "b" });
  });

  it("ignores a line that is not JSON rather than failing the run", () => {
    // The CLI prints human lines to stdout alongside the stream; one of them is
    // not a verdict on the change.
    expect(readStream(`Reading additional input from stdin...\n${STREAM}`).ok).toBe(true);
  });

  it("reports no message as invalid output, not as a verdict", () => {
    const empty = readStream(line({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 0 } }));
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.error.kind).toBe("invalid-output");
  });

  it("reports a message that is not JSON as invalid output", () => {
    const prose = line({ type: "item.completed", item: { type: "agent_message", text: "I think it is fine" } });
    expect(readStream(prose).ok).toBe(false);
  });

  it("still reports the tokens when the message could not be read", () => {
    // The call was paid for whether or not it answered, and hard rule 3 turns on
    // telling a broken run apart from a bad change.
    const broken = [
      line({ type: "item.completed", item: { type: "agent_message", text: "not json" } }),
      line({ type: "turn.completed", usage: { input_tokens: 900, output_tokens: 7 } }),
    ].join("\n");
    expect(readStream(broken).usage.inputTokens).toBe(900);
  });

  it("reads an empty stream as invalid output with no tokens", () => {
    const nothing = readStream("");
    expect(nothing.ok).toBe(false);
    expect(nothing.usage).toEqual({ inputTokens: 0, outputTokens: 0, durationMs: 0 });
  });
});
