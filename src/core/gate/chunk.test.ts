import { describe, expect, it } from "vitest";
import { aggregateChunkOutcomes, chunkDiff } from "./chunk.js";
import type { CheckOutcome } from "../contracts.js";

const fileDiff = (path: string, body = "+a\n-b\n") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n${body}`;

describe("chunkDiff", () => {
  it("returns nothing for an empty diff", () => {
    expect(chunkDiff("", 1000)).toEqual([]);
    expect(chunkDiff("   \n", 1000)).toEqual([]);
  });

  it("keeps a small diff as a single chunk", () => {
    const chunks = chunkDiff(fileDiff("a.ts") + fileDiff("b.ts"), 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.files).toEqual(["a.ts", "b.ts"]);
  });

  it("splits on file boundaries once the budget is exceeded", () => {
    const big = fileDiff("a.ts", "+x\n".repeat(200));
    const chunks = chunkDiff(big + fileDiff("b.ts"), 300);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk names the files it carries, so a verdict can be attributed.
    expect(chunks.flatMap((c) => c.files)).toEqual(["a.ts", "b.ts"]);
  });

  it("never splits a single file across chunks", () => {
    // A half-file is not reviewable: the lens would judge a fragment with no
    // idea what the rest of the function does, and report on it confidently.
    const huge = fileDiff("big.ts", "+x\n".repeat(5000));
    const chunks = chunkDiff(huge, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.files).toEqual(["big.ts"]);
    expect(chunks[0]?.oversized).toBe(true);
  });

  it("marks an oversized chunk so the caller can widen its budget", () => {
    const chunks = chunkDiff(fileDiff("big.ts", "+x\n".repeat(5000)), 100);
    expect(chunks[0]?.oversized).toBe(true);
  });

  it("keeps each chunk a VALID diff, not a fragment", () => {
    const chunks = chunkDiff(fileDiff("a.ts", "+x\n".repeat(200)) + fileDiff("b.ts"), 300);
    for (const c of chunks) expect(c.diff.startsWith("diff --git")).toBe(true);
  });

  it("tolerates a diff with no recognisable file headers", () => {
    const chunks = chunkDiff("just some text\nwith no headers\n", 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.files).toEqual([]);
  });
});

const pass: CheckOutcome = { status: "pass" };
const fail = (d: string): CheckOutcome => ({ status: "fail", detail: d });
const errored = (d: string): CheckOutcome => ({ status: "errored", detail: d });

describe("aggregateChunkOutcomes", () => {
  it("passes only when every chunk passed", () => {
    expect(aggregateChunkOutcomes([pass, pass]).status).toBe("pass");
  });

  it("fails when any chunk found a real problem", () => {
    // A bug anywhere in the change is a bug in the change.
    expect(aggregateChunkOutcomes([pass, fail("null deref"), pass]).status).toBe("fail");
  });

  it("keeps every failing chunk's detail, not just the first", () => {
    const out = aggregateChunkOutcomes([fail("bug A"), fail("bug B")]);
    if (out.status === "fail") {
      expect(out.detail).toContain("bug A");
      expect(out.detail).toContain("bug B");
    }
  });

  // THE HONESTY RULE. Partial coverage is not a pass. If a chunk could not be
  // judged, the change was not fully reviewed, and saying "pass" would claim
  // verification that never happened.
  it("ERRORS when a chunk could not be judged, even if the rest passed", () => {
    const out = aggregateChunkOutcomes([pass, errored("budget"), pass]);
    expect(out.status).toBe("errored");
    if (out.status === "errored") expect(out.detail).toMatch(/1 of 3/);
  });

  // ...but a real finding still counts. We looked, and we found something.
  it("reports FAIL over ERRORED when some chunk found a real problem", () => {
    const out = aggregateChunkOutcomes([fail("real bug"), errored("budget")]);
    expect(out.status).toBe("fail");
    if (out.status === "fail") expect(out.detail).toMatch(/1 of 2 .*not (be )?judged|unreviewed/i);
  });

  it("errors on an empty outcome list rather than claiming a pass", () => {
    expect(aggregateChunkOutcomes([]).status).toBe("errored");
  });
});
