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

  // ── Tool-call markup ─────────────────────────────────────────────────────
  // Observed live and then MEASURED. The model closes its tool call INSIDE the
  // string field: the reason ends with "</parameter>\n</invoke>\n" while the prose
  // before it is complete and the verdict is correct. Rate is size-correlated —
  // 0/40 runs on diffs under 10 lines, 13/40 on 11-15 line diffs (sig-0008).
  //
  // The first version of this rule REJECTED the whole verdict, which threw away
  // correct answers and burned three billed retries into the same failure. A gate
  // blind on a third of realistic diffs is worse than one that strips a known,
  // well-formed suffix. So: recover from the TRAILING artifact, keep rejecting
  // markup anywhere else, and report what was stripped rather than doing it
  // silently.

  it("recovers a correct verdict whose reason ends in tool-call markup", () => {
    // Captured verbatim from a live run against race-good.diff.
    const out = interpretEnvelope(
      envelope({
        structured_output: {
          verdict: "pass",
          reason:
            "The refresh propagates to all waiters, avoiding a stampede — an improvement, " +
            "not a regression. No correctness bug is introduced.</parameter>\n</invoke>\n",
        },
      }),
      LensVerdict,
      opts,
    );
    expect(out.kind).toBe("accept");
    if (out.kind === "accept") {
      expect(out.value.verdict).toBe("pass");
      expect(out.value.reason).toMatch(/No correctness bug is introduced\.$/);
      expect(out.value.reason).not.toContain("</parameter>");
      expect(out.sanitized).toBeDefined(); // stripping is reported, never silent
    }
  });

  it("strips a bare closing tag with trailing whitespace", () => {
    const out = interpretEnvelope(
      envelope({ structured_output: { verdict: "fail", reason: "Off by one.</parameter>  \n" } }),
      LensVerdict,
      opts,
    );
    expect(out.kind).toBe("accept");
    if (out.kind === "accept") expect(out.value.reason).toBe("Off by one.");
  });

  // The safety half of the rule: markup in the MIDDLE means the content itself is
  // interleaved with scaffolding, not merely suffixed by it. That is unrecoverable
  // and must still fail closed.
  it("still REJECTS markup embedded mid-string", () => {
    const out = interpretEnvelope(
      envelope({
        structured_output: {
          verdict: "pass",
          reason: "Looks fine</invoke>\n<invoke name=\"other\">and then some more prose.",
        },
      }),
      LensVerdict,
      opts,
    );
    expect(out.kind).toBe("retry");
    if (out.kind === "retry") expect(out.reason).toMatch(/contaminat/i);
  });

  it("does not strip anything from a clean verdict", () => {
    const out = interpretEnvelope(envelope(), LensVerdict, opts);
    expect(out.kind).toBe("accept");
    if (out.kind === "accept") expect(out.sanitized).toBeUndefined();
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
