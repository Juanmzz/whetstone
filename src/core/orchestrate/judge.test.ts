import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { judgeWithRetry, type SingleShot } from "./judge.js";

const Schema = z.object({ verdict: z.enum(["pass", "fail"]), reason: z.string() });

function shot(structured: unknown, over: Record<string, unknown> = {}) {
  return {
    envelope: { is_error: false, subtype: "success", structured_output: structured, ...over },
    raw: JSON.stringify(structured),
    costUsd: 0.03,
    inputTokens: 11_000,
    outputTokens: 500,
    durationMs: 1200,
    sessionId: "s1",
  };
}

const req = { lens: "review it", prompt: "a diff", schema: Schema } as const;

describe("judgeWithRetry", () => {
  it("returns the verdict on a first-attempt success", async () => {
    const invoke = vi.fn(async () => shot({ verdict: "pass", reason: "fine" })) as SingleShot;
    const result = await judgeWithRetry(req, invoke);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ verdict: "pass", reason: "fine" });
    expect(result.attempts).toHaveLength(1);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("retries an unrecoverably contaminated payload and accepts the clean one", async () => {
    // Markup EMBEDDED mid-content is unrecoverable, so it must still cost a retry.
    // (Trailing markup is now sanitised in place and accepted on the first attempt —
    // see verdict.test.ts. Rejecting it made the gate blind on a third of
    // realistic-length diffs while billing three retries per failure.)
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        shot({ verdict: "pass", reason: 'ok</invoke>\n<invoke name="x">more prose' }),
      )
      .mockResolvedValueOnce(shot({ verdict: "pass", reason: "ok" })) as unknown as SingleShot;

    const result = await judgeWithRetry(req, invoke);
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.outcome).toBe("retry");
  });

  it("accepts a trailing-markup payload on the FIRST attempt, without a retry", async () => {
    const invoke = vi.fn(async () =>
      shot({ verdict: "pass", reason: "No bug introduced.</parameter>\n</invoke>\n" }),
    ) as SingleShot;

    const result = await judgeWithRetry(req, invoke);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ verdict: "pass", reason: "No bug introduced." });
    expect(invoke).toHaveBeenCalledOnce(); // the whole point: no billed retries
  });

  it("accumulates cost across attempts — retries are not free", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(shot(undefined))
      .mockResolvedValueOnce(shot({ verdict: "fail", reason: "no" })) as unknown as SingleShot;

    const result = await judgeWithRetry(req, invoke);
    expect(result.costUsd).toBeCloseTo(0.06);
  });

  it("gives up after maxAttempts with invalid-output", async () => {
    const invoke = vi.fn(async () => shot(undefined)) as SingleShot;
    const result = await judgeWithRetry({ ...req, maxAttempts: 2 }, invoke);

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("invalid-output");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  // Retrying a budget stop just burns more budget; retrying a missing binary
  // never succeeds. Infrastructure failures must short-circuit.
  it("does NOT retry an infrastructure failure", async () => {
    const invoke = vi.fn(async () =>
      shot(undefined, { is_error: true, subtype: "error_max_budget" }),
    ) as SingleShot;

    const result = await judgeWithRetry({ ...req, maxAttempts: 5 }, invoke);
    expect(result.error?.kind).toBe("budget");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("surfaces a spawn failure instead of throwing", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("spawn claude ENOENT");
    }) as SingleShot;

    const result = await judgeWithRetry(req, invoke);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("spawn");
    expect(result.error?.detail).toMatch(/ENOENT/);
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async () => shot(undefined)) as SingleShot;

    const result = await judgeWithRetry({ ...req, signal: controller.signal }, invoke);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("timeout");
    expect(invoke).not.toHaveBeenCalled();
  });
});
