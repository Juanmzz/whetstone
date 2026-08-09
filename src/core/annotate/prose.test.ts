import { describe, expect, it } from "vitest";
import type { Tier } from "../checks/schema.js";
import type { CheckOutcome, CheckResult, GateVerdict, TriageResult } from "../contracts.js";
import { aggregate } from "../gate/aggregate.js";
import type { JudgeRequest, JudgeResult, LlmJudge } from "../ports.js";
import { annotate, type Annotation } from "./annotate.js";
import type { CheckCoverage } from "./findings.js";
import { ProseSchema, writeProse } from "./prose.js";

function result(
  checkId: string,
  severity: CheckResult["severity"],
  outcome: CheckOutcome,
): CheckResult {
  return { checkId, checkVersion: 1, severity, outcome, durationMs: 1 };
}
const verdictOf = (...r: CheckResult[]): GateVerdict => aggregate(r);
function triageOf(files: readonly (readonly [string, Tier])[]): TriageResult {
  const RANK: Record<Tier, number> = { off: 0, light: 1, strict: 2 };
  const matches = files.map(([path, tier]) => ({
    file: { path, status: "modified" as const },
    tier,
    reason: `${tier} by rule`,
  }));
  const tier = matches.reduce<Tier>((a, m) => (RANK[m.tier] > RANK[a] ? m.tier : a), "off");
  return { tier, matches, rulesSource: "test", reason: `${tier} — test` };
}
const covering = (checkId: string, ...paths: string[]): CheckCoverage => ({ checkId, paths });

// ── a recording fake judge ───────────────────────────────────────────────────

interface Recorder {
  readonly judge: LlmJudge;
  readonly calls: JudgeRequest<typeof ProseSchema>[];
}

function fakeJudge(reply: (n: number) => unknown, ok = true, costUsd = 0.01): Recorder {
  const calls: JudgeRequest<typeof ProseSchema>[] = [];
  const judge: LlmJudge = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    judge: (async (req: JudgeRequest<typeof ProseSchema>) => {
      calls.push(req);
      const meta = {
        attempts: [],
        raw: "",
        costUsd,
        inputTokens: 10,
        outputTokens: 5,
        durationMs: 1,
        sessionId: null,
      };
      return ok
        ? { ok: true, value: reply(calls.length), ...meta }
        : { ok: false, error: { kind: "timeout", detail: "judge timed out" }, ...meta };
    }) as LlmJudge["judge"],
    describe: async () => ({ name: "fake", version: null }),
  };
  return { judge, calls };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

function twoRedOneSkim(): Annotation {
  return annotate({
    triage: triageOf([
      ["src/core/a.ts", "strict"],
      ["src/core/b.ts", "strict"],
      ["src/core/c.ts", "strict"],
    ]),
    verdict: verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "src/core/a.ts:3:1 - error TS1\nsrc/core/b.ts:9:1 - error TS2",
      }),
    ),
    coverage: [covering("typecheck", "src/core/a.ts", "src/core/b.ts", "src/core/c.ts")],
  });
}

function noRed(): Annotation {
  return annotate({
    triage: triageOf([["src/core/a.ts", "strict"]]),
    verdict: verdictOf(result("typecheck", "block", { status: "pass" })),
    coverage: [covering("typecheck", "src/core/a.ts")],
  });
}

// ── the tests ────────────────────────────────────────────────────────────────

describe("writeProse — frugality", () => {
  it("does not call the judge AT ALL when nothing is 🔴", async () => {
    const rec = fakeJudge(() => ({ items: [] }));
    const out = await writeProse({ annotation: noRed() }, rec.judge);

    expect(rec.calls).toEqual([]);
    expect(out.prose.size).toBe(0);
    expect(out.costUsd).toBe(0);
  });

  it("makes ONE call for all the red files, not one per file", async () => {
    const rec = fakeJudge(() => ({
      items: [
        { path: "src/core/a.ts", why: "because A" },
        { path: "src/core/b.ts", why: "because B" },
      ],
    }));
    await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(rec.calls).toHaveLength(1);
  });
});

describe("writeProse — what the LLM is shown", () => {
  it("shows it the 🔴 files and their findings, and NOT the 🟡 ones", async () => {
    const rec = fakeJudge(() => ({ items: [] }));
    await writeProse({ annotation: twoRedOneSkim() }, rec.judge);

    const prompt = rec.calls[0]?.prompt ?? "";
    expect(prompt).toContain("src/core/a.ts");
    expect(prompt).toContain("src/core/b.ts");
    expect(prompt).not.toContain("src/core/c.ts");
    expect(prompt).toContain("error TS1");
  });

  it("passes the diff through when one is supplied", async () => {
    const rec = fakeJudge(() => ({ items: [] }));
    await writeProse({ annotation: twoRedOneSkim(), diff: "@@ -1 +1 @@ MARKER" }, rec.judge);
    expect(rec.calls[0]?.prompt).toContain("MARKER");
  });

  it("asks for WHY-to-look prose, and binds the schema", async () => {
    const rec = fakeJudge(() => ({ items: [] }));
    await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(rec.calls[0]?.lens.toLowerCase()).toContain("why");
    expect(rec.calls[0]?.schema).toBe(ProseSchema);
  });

  it("honours the model, budget and timeout it is given", async () => {
    const rec = fakeJudge(() => ({ items: [] }));
    await writeProse(
      { annotation: twoRedOneSkim(), model: "haiku", maxBudgetUsd: 0.25, timeoutMs: 5000 },
      rec.judge,
    );
    expect(rec.calls[0]?.model).toBe("haiku");
    expect(rec.calls[0]?.maxBudgetUsd).toBe(0.25);
    expect(rec.calls[0]?.timeoutMs).toBe(5000);
  });
});

describe("writeProse — what comes back", () => {
  it("keys the prose by path", async () => {
    const rec = fakeJudge(() => ({
      items: [
        { path: "src/core/a.ts", why: "because A" },
        { path: "src/core/b.ts", why: "because B" },
      ],
    }));
    const out = await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(out.prose.get("src/core/a.ts")).toBe("because A");
    expect(out.prose.get("src/core/b.ts")).toBe("because B");
  });

  /** A judge that invents a file is a judge writing about code it was not shown. */
  it("discards prose for a path that is not 🔴", async () => {
    const rec = fakeJudge(() => ({
      items: [
        { path: "src/core/c.ts", why: "skim file" },
        { path: "src/invented.ts", why: "hallucination" },
      ],
    }));
    const out = await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(out.prose.size).toBe(0);
  });

  it("reports what it spent", async () => {
    const rec = fakeJudge(() => ({ items: [] }), true, 0.03);
    expect((await writeProse({ annotation: twoRedOneSkim() }, rec.judge)).costUsd).toBe(0.03);
  });

  /**
   * The prose is a BONUS. The engine already wrote a reason for every file, so a
   * judge that cannot answer costs the reviewer nuance and never the annotation.
   */
  it("degrades to no prose when the judge fails — it never throws", async () => {
    const rec = fakeJudge(() => ({ items: [] }), false, 0.02);
    const out = await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(out.prose.size).toBe(0);
    expect(out.error).toContain("timeout");
    expect(out.costUsd).toBe(0.02);
  });

  it("degrades to no prose when the judge throws outright", async () => {
    const judge: LlmJudge = {
      judge: () => Promise.reject(new Error("spawn ENOENT")),
      describe: async () => ({ name: "fake", version: null }),
    };
    const out = await writeProse({ annotation: twoRedOneSkim() }, judge);
    expect(out.prose.size).toBe(0);
    expect(out.error).toContain("ENOENT");
  });

  it("drops an empty or whitespace-only `why` rather than rendering a blank quote", async () => {
    const rec = fakeJudge(() => ({ items: [{ path: "src/core/a.ts", why: "   " }] }));
    const out = await writeProse({ annotation: twoRedOneSkim() }, rec.judge);
    expect(out.prose.size).toBe(0);
  });
});
