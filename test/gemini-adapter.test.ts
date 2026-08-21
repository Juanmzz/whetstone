/**
 * The Gemini envelope, pinned to a real one.
 *
 * Captured from `gemini -p '...' -o json` on 3.x. Every field this adapter reads is
 * in it, including the two the shape of `claude -p` would not predict: `response` is
 * a STRING carrying the model's answer, and `stats.models` holds more than one model
 * for a single call, because the CLI routes through a utility model first.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildPrompt, firstJsonObject, parseResponse, tallyStats } from "../src/shell/gemini.js";

const REAL = {
  session_id: "682260e3-3d06-4934-9f33-96f9225d964c",
  response: '{"verdict":"pass","reason":"prueba"}',
  stats: {
    models: {
      "gemini-3.1-flash-lite": {
        api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 12739 },
        tokens: { input: 3603, prompt: 3603, candidates: 41, total: 5098 },
      },
      "gemini-3.5-flash": {
        api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 4691 },
        tokens: { input: 19070, prompt: 19070, candidates: 10, total: 19713 },
      },
    },
  },
};

describe("the captured envelope", () => {
  it("is found past the warnings the CLI prints before it", () => {
    const noisy = `Skill "skill-creator" is overriding the built-in skill.\n${JSON.stringify(REAL)}`;

    expect((firstJsonObject(noisy) as { session_id: string }).session_id).toBe(REAL.session_id);
  });

  it("yields the verdict from `response`, which is a string and not an object", () => {
    expect(parseResponse(REAL.response)).toEqual({ verdict: "pass", reason: "prueba" });
  });

  it("sums tokens across every model one call routed through", () => {
    // 3603 + 19070 prompt, 41 + 10 candidates. Reading one model undercounts by 84%.
    expect(tallyStats(REAL.stats)).toEqual({ input: 22673, output: 51, ms: 17430 });
  });
});

describe("a response that is not clean JSON", () => {
  it("is read through a code fence, which a model adds unasked", () => {
    expect(parseResponse('```json\n{"verdict":"fail"}\n```')).toEqual({ verdict: "fail" });
  });

  it("throws rather than inventing a verdict when there is no JSON at all", () => {
    expect(() => parseResponse("I could not review that.")).toThrow(/no JSON/);
  });
});

describe("buildPrompt", () => {
  const req = {
    lens: "You are a correctness lens.",
    prompt: "Review this diff.",
    schema: z.object({ verdict: z.enum(["pass", "fail"]) }),
  };

  it("carries the lens, since Gemini has no system-prompt flag to put it in", () => {
    expect(buildPrompt(req)).toContain("You are a correctness lens.");
  });

  it("carries the schema, since Gemini has no --json-schema either", () => {
    expect(buildPrompt(req)).toContain('"enum":["pass","fail"]');
  });

  it("does not carry the $schema key, which is metadata and not a constraint", () => {
    expect(buildPrompt(req)).not.toContain("$schema");
  });
});
