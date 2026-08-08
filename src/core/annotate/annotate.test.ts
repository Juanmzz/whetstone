import { describe, expect, it } from "vitest";
import type { Tier } from "../checks/schema.js";
import type { CheckOutcome, CheckResult, GateVerdict, TriageResult } from "../contracts.js";
import { aggregate } from "../gate/aggregate.js";
import { annotate } from "./annotate.js";
import type { CheckCoverage } from "./findings.js";

// ── builders ─────────────────────────────────────────────────────────────────

function result(
  checkId: string,
  severity: CheckResult["severity"],
  outcome: CheckOutcome,
): CheckResult {
  return { checkId, checkVersion: 1, severity, outcome, durationMs: 1 };
}

const verdictOf = (...results: CheckResult[]): GateVerdict => aggregate(results);

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

// ── the 40-file change ───────────────────────────────────────────────────────

describe("a 40-file strict change with one real finding", () => {
  const paths = Array.from({ length: 40 }, (_, i) => `src/core/gate/f${i}.ts`);
  const annotation = annotate({
    triage: triageOf(paths.map((p) => [p, "strict"] as const)),
    verdict: verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "src/core/gate/f7.ts:112:7 - error TS2345",
      }),
    ),
    coverage: [covering("typecheck", ...paths)],
  });

  it("marks exactly ONE file red", () => {
    const red = annotation.files.filter((f) => f.criticality === "review");
    expect(red.map((f) => f.path)).toEqual(["src/core/gate/f7.ts"]);
  });

  it("leaves the other 39 at skim — visible, but not shouting", () => {
    expect(annotation.counts).toEqual({ review: 1, skim: 39, skip: 0 });
  });

  it("puts the red file first, so the reviewer's eye lands on it", () => {
    expect(annotation.files[0]?.path).toBe("src/core/gate/f7.ts");
  });

  it("requests changes: strict tier plus a block-severity finding", () => {
    expect(annotation.blocking).toBe(true);
    expect(annotation.event).toBe("REQUEST_CHANGES");
  });
});

// ── the zero-finding case ────────────────────────────────────────────────────

describe("no findings at all", () => {
  const annotation = annotate({
    triage: triageOf([
      ["README.md", "light"],
      ["docs/x.md", "off"],
      ["CHANGELOG.md", "off"],
    ]),
    verdict: verdictOf(result("typecheck", "block", { status: "pass" })),
    coverage: [covering("typecheck", "README.md")],
  });

  it("does not manufacture red", () => {
    expect(annotation.counts).toEqual({ review: 0, skim: 0, skip: 3 });
    expect(annotation.clean).toBe(true);
  });

  it("comments rather than requesting changes", () => {
    expect(annotation.blocking).toBe(false);
    expect(annotation.event).toBe("COMMENT");
  });
});

// ── errored is not a finding ─────────────────────────────────────────────────

describe("an errored check — the gate could not run it", () => {
  const annotation = annotate({
    triage: triageOf([["src/core/gate/run.ts", "strict"]]),
    verdict: verdictOf(
      result("correctness", "block", {
        status: "errored",
        detail: "the review lens produced no usable verdict (timeout): src/core/gate/run.ts:1",
      }),
    ),
    coverage: [covering("correctness", "src/core/gate/run.ts")],
  });

  it("never produces a 🔴 — a check that did not run made no judgement", () => {
    expect(annotation.counts.review).toBe(0);
    expect(annotation.files[0]?.criticality).toBe("skim"); // strict floor, nothing more
  });

  it("reports it as NOT VERIFIED on the file it would have covered", () => {
    expect(annotation.files[0]?.notVerified).toEqual(["correctness"]);
    expect(annotation.files[0]?.reason).toContain("NOT VERIFIED");
  });

  /**
   * The generic "strict tier, no finding" sentence is the FALLBACK for a row with
   * nothing else to say. Prefixing it to a row that does have something to say
   * buries the only part a reader needs. Found by running `wst pr --dry-run` on
   * this lane's own commit — eleven rows, each opening with the same clause.
   */
  it("does not prefix the not-verified note with boilerplate", () => {
    expect(annotation.files[0]?.reason).toBe("NOT VERIFIED: correctness could not run");
  });

  it("does not request changes on the strength of a broken check", () => {
    expect(annotation.blocking).toBe(false);
    expect(annotation.event).toBe("COMMENT");
  });

  it("is not `clean` — nothing failed, but something was not checked", () => {
    expect(annotation.clean).toBe(true);
    expect(annotation.notVerified).toEqual(["correctness"]);
  });
});

// ── receipt skips ────────────────────────────────────────────────────────────

describe("a finding on a file whose other check was skipped by receipt", () => {
  const annotation = annotate({
    triage: triageOf([["src/core/gate/run.ts", "strict"]]),
    verdict: verdictOf(
      result("typecheck", "block", { status: "skipped", reason: "receipt" }),
      result("test", "block", { status: "fail", detail: "src/core/gate/run.ts:4 assertion failed" }),
    ),
    coverage: [
      covering("typecheck", "src/core/gate/run.ts"),
      covering("test", "src/core/gate/run.ts"),
    ],
  });

  const file = annotation.files[0];

  it("is still red — the receipt vouches for typecheck, not for `test`", () => {
    expect(file?.criticality).toBe("review");
  });

  it("says WHICH check was reused, so the reader knows what was not re-run", () => {
    expect(file?.viaReceipt).toEqual(["typecheck"]);
    expect(file?.reason).toContain("typecheck");
    expect(file?.reason).toContain("receipt");
  });

  it("a receipt skip is a PASS on identical input, so it is not `notVerified`", () => {
    expect(file?.notVerified).toEqual([]);
  });
});

// ── unattributed findings ────────────────────────────────────────────────────

describe("a real failure that names no file", () => {
  const annotation = annotate({
    triage: triageOf([
      ["src/core/a.ts", "strict"],
      ["src/core/b.ts", "strict"],
    ]),
    verdict: verdictOf(result("test", "block", { status: "fail", detail: "3 tests failed" })),
    coverage: [covering("test", "src/core/a.ts", "src/core/b.ts")],
  });

  it("colours no file red — we do not know where to look and will not pretend", () => {
    expect(annotation.counts.review).toBe(0);
  });

  it("still blocks: the failure is real even though it is not localised", () => {
    expect(annotation.blocking).toBe(true);
    expect(annotation.event).toBe("REQUEST_CHANGES");
    expect(annotation.unattributed.map((f) => f.checkId)).toEqual(["test"]);
  });
});

// ── the tier/blocking boundary ───────────────────────────────────────────────

describe("blocking", () => {
  const withFinding = (tier: Tier, severity: CheckResult["severity"]) =>
    annotate({
      triage: triageOf([["src/x.ts", tier]]),
      verdict: verdictOf(result("c", severity, { status: "fail", detail: "src/x.ts:1 bad" })),
      coverage: [covering("c", "src/x.ts")],
    });

  it("strict + block-severity finding → REQUEST_CHANGES", () => {
    expect(withFinding("strict", "block").event).toBe("REQUEST_CHANGES");
  });

  it("strict + warn-severity finding → COMMENT (severity is obeyed absolutely)", () => {
    expect(withFinding("strict", "warn").event).toBe("COMMENT");
  });

  /**
   * The annotation is a REVIEW POSTURE, not the enforcement channel. `wst gate`'s
   * exit code already blocks CI on any block-severity failure at any tier; asking a
   * human to formally reject a `light` change is ceremony the tier explicitly opted
   * out of.
   */
  it("light + block-severity finding → COMMENT, while the gate still says block", () => {
    const a = withFinding("light", "block");
    expect(a.event).toBe("COMMENT");
    expect(a.files[0]?.criticality).toBe("review"); // still worth looking at
  });
});

// ── determinism and shape ────────────────────────────────────────────────────

describe("shape", () => {
  const input = {
    triage: triageOf([
      ["z.md", "off"] as const,
      ["src/core/b.ts", "strict"] as const,
      ["src/core/a.ts", "strict"] as const,
    ]),
    verdict: verdictOf(
      result("typecheck", "block", { status: "fail", detail: "src/core/b.ts:1 - error TS1" }),
    ),
    coverage: [covering("typecheck", "src/core/a.ts", "src/core/b.ts")],
  };

  it("orders review, then skim, then skip; alphabetically within a level", () => {
    expect(annotate(input).files.map((f) => `${f.criticality}:${f.path}`)).toEqual([
      "review:src/core/b.ts",
      "skim:src/core/a.ts",
      "skip:z.md",
    ]);
  });

  it("is deterministic — two runs over one input are identical", () => {
    expect(annotate(input)).toEqual(annotate(input));
  });

  it("annotates EVERY changed file exactly once", () => {
    const files = annotate(input).files;
    expect(files).toHaveLength(3);
    expect(new Set(files.map((f) => f.path)).size).toBe(3);
  });

  it("gives every file an engine-written reason, with no LLM in sight", () => {
    for (const file of annotate(input).files) expect(file.reason.length).toBeGreaterThan(0);
  });

  it("carries the change's overall tier through", () => {
    expect(annotate(input).tier).toBe("strict");
  });

  it("handles an empty diff without inventing anything", () => {
    const empty = annotate({ triage: triageOf([]), verdict: verdictOf(), coverage: [] });
    expect(empty.files).toEqual([]);
    expect(empty.counts).toEqual({ review: 0, skim: 0, skip: 0 });
    expect(empty.event).toBe("COMMENT");
    expect(empty.clean).toBe(true);
  });
});

describe("a finding on a path that is not in the diff", () => {
  it("is demoted to unattributed rather than inventing a file row", () => {
    const annotation = annotate({
      triage: triageOf([["src/core/a.ts", "strict"]]),
      verdict: verdictOf(
        result("typecheck", "block", { status: "fail", detail: "src/ghost.ts:1 - error TS1" }),
      ),
      // Coverage claims a file the diff does not contain — a stale or hand-built input.
      coverage: [covering("typecheck", "src/ghost.ts")],
    });

    expect(annotation.files.map((f) => f.path)).toEqual(["src/core/a.ts"]);
    expect(annotation.unattributed.map((f) => f.checkId)).toEqual(["typecheck"]);
    expect(annotation.counts.review).toBe(0);
  });
});
