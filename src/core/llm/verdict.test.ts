import { describe, expect, it } from "vitest";
import { z } from "zod";
import { interpretEnvelope } from "./verdict.js";

const LensVerdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
});

/** Shape of a real `claude -p --output-format json` envelope (fields we rely on). */
function envelope(over: Record<string, unknown> = {}) {
  return {
    is_error: false,
    subtype: "success",
    result: '{"verdict":"pass","reason":"looks fine"}',
    structured_output: { verdict: "pass", reason: "looks fine" },
    total_cost_usd: 0.0246,
    usage: { input_tokens: 2, output_tokens: 697, cache_read_input_tokens: 11594 },
    session_id: "37e756aa",
    duration_ms: 11132,
    ...over,
  };
}

const opts = { attempt: 1, maxAttempts: 3 };

describe("interpretEnvelope", () => {
  it("accepts a well-formed structured verdict", () => {
    const out = interpretEnvelope(envelope(), LensVerdict, opts);
    expect(out).toEqual({
      kind: "accept",
      value: { verdict: "pass", reason: "looks fine" },
    });
  });

  it("retries when structured_output is missing entirely", () => {
    const out = interpretEnvelope(envelope({ structured_output: undefined }), LensVerdict, opts);
    expect(out.kind).toBe("retry");
  });

  it("retries when the payload violates the schema", () => {
    const bad = envelope({ structured_output: { verdict: "maybe", reason: "hedge" } });
    const out = interpretEnvelope(bad, LensVerdict, opts);
    expect(out.kind).toBe("retry");
  });

  // THE REGRESSION THAT MATTERS. Observed live: replacing the system prompt made the
  // model leak raw tool-call markup INTO a schema-valid string field. Schema validation
  // passes; the value is garbage. Native validation is necessary, not sufficient.
  it("rejects tool-call markup leaking into a schema-VALID string", () => {
    const contaminated = envelope({
      structured_output: {
        verdict: "pass",
        reason:
          "The change guards the call before invoking foo.bar().</parameter>\n</invoke>\n",
      },
    });
    const out = interpretEnvelope(contaminated, LensVerdict, opts);
    expect(out.kind).toBe("retry");
    if (out.kind === "retry") expect(out.reason).toMatch(/contaminat/i);
  });

  // The contamination check must not be so eager that it breaks real reviews:
  // any lens looking at HTML/JSX will legitimately quote closing tags.
  it("does not mistake real markup in a review for contamination", () => {
    const jsx = envelope({
      structured_output: {
        verdict: "fail",
        reason: "The </div> on line 12 closes an element that was never opened.",
      },
    });
    expect(interpretEnvelope(jsx, LensVerdict, opts).kind).toBe("accept");
  });

  it("gives up with invalid-output once attempts are exhausted", () => {
    const out = interpretEnvelope(envelope({ structured_output: undefined }), LensVerdict, {
      attempt: 3,
      maxAttempts: 3,
    });
    expect(out).toMatchObject({ kind: "fail", error: { kind: "invalid-output" } });
  });

  // Infrastructure failures must NOT read as a failed check — only a real
  // verdict may block. This is the distinction Step 3's gate depends on.
  it("classifies a budget stop as infrastructure, never as a check failure", () => {
    const out = interpretEnvelope(
      envelope({ is_error: true, subtype: "error_max_budget", structured_output: undefined }),
      LensVerdict,
      opts,
    );
    expect(out).toMatchObject({ kind: "fail", error: { kind: "budget" } });
  });

  it("classifies max-turns exhaustion as infrastructure", () => {
    const out = interpretEnvelope(
      envelope({ is_error: true, subtype: "error_max_turns", structured_output: undefined }),
      LensVerdict,
      opts,
    );
    expect(out).toMatchObject({ kind: "fail", error: { kind: "max-turns" } });
  });

  it("does not retry a hard error even with attempts remaining", () => {
    const out = interpretEnvelope(
      envelope({ is_error: true, subtype: "error_max_budget" }),
      LensVerdict,
      { attempt: 1, maxAttempts: 5 },
    );
    expect(out.kind).toBe("fail");
  });

  it("rejects a non-object envelope instead of trusting it", () => {
    expect(interpretEnvelope(null, LensVerdict, opts).kind).toBe("fail");
    expect(interpretEnvelope("nope", LensVerdict, opts).kind).toBe("fail");
  });
});
