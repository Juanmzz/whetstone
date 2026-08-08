import { describe, expect, it } from "vitest";
import type { Tier } from "../checks/schema.js";
import type { CheckOutcome, CheckResult, GateVerdict, TriageResult } from "../contracts.js";
import { aggregate } from "../gate/aggregate.js";
import { annotate, type Annotation } from "./annotate.js";
import {
  BODY_END,
  BODY_START,
  fingerprint,
  inlineComments,
  pruneAlreadyPosted,
  renderBody,
  reviewSummary,
  shouldPostReview,
  upsertManagedBlock,
} from "./body.js";
import type { CheckCoverage } from "./findings.js";

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

/** One red, two skim, three trivial — the shape the body has to handle well. */
function mixed(): Annotation {
  return annotate({
    triage: triageOf([
      ["src/core/gate/run.ts", "strict"],
      ["src/core/gate/select.ts", "strict"],
      ["src/core/gate/report.ts", "strict"],
      ["README.md", "light"],
      ["docs/a.md", "off"],
      ["docs/b.md", "off"],
    ]),
    verdict: verdictOf(
      result("typecheck", "block", {
        status: "fail",
        detail: "src/core/gate/run.ts:112:7 - error TS2345",
      }),
    ),
    coverage: [
      covering("typecheck", "src/core/gate/run.ts", "src/core/gate/select.ts", "src/core/gate/report.ts"),
    ],
  });
}

describe("renderBody", () => {
  const body = renderBody(mixed());

  it("wraps itself in markers so it can be replaced instead of appended", () => {
    expect(body.startsWith(BODY_START)).toBe(true);
    expect(body.trimEnd().endsWith(BODY_END)).toBe(true);
  });

  it("lists every 🔴 by name", () => {
    expect(body).toContain("🔴");
    expect(body).toContain("src/core/gate/run.ts");
  });

  it("lists every 🟡 by name", () => {
    expect(body).toContain("src/core/gate/select.ts");
    expect(body).toContain("src/core/gate/report.ts");
  });

  /** Nothing hidden, nothing noisy. */
  it("collapses ⚪ into exactly ONE line, and does not name those files", () => {
    const white = body.split("\n").filter((l) => l.includes("⚪"));
    expect(white).toHaveLength(1);
    expect(white[0]).toContain("3");
    expect(body).not.toContain("docs/a.md");
    expect(body).not.toContain("docs/b.md");
  });

  it("says the tier and the counts up front", () => {
    expect(body).toMatch(/strict/);
  });

  it("is deterministic", () => {
    expect(renderBody(mixed())).toBe(renderBody(mixed()));
  });
});

describe("renderBody — the honest edges", () => {
  it("with zero findings, says so in one line and draws no red", () => {
    const body = renderBody(
      annotate({
        triage: triageOf([
          ["docs/a.md", "off"],
          ["docs/b.md", "off"],
        ]),
        verdict: verdictOf(result("typecheck", "block", { status: "pass" })),
        coverage: [],
      }),
    );
    expect(body).not.toContain("🔴");
    expect(body).toContain("⚪");
    expect(body).toContain("2");
  });

  it("names an unattributed failure rather than pinning it on a file", () => {
    const body = renderBody(
      annotate({
        triage: triageOf([["src/core/a.ts", "strict"]]),
        verdict: verdictOf(result("test", "block", { status: "fail", detail: "3 tests failed" })),
        coverage: [covering("test", "src/core/a.ts")],
      }),
    );
    expect(body).not.toContain("🔴");
    expect(body).toContain("test");
    expect(body).toContain("no file");
  });

  it("warns loudly when a check could not run", () => {
    const body = renderBody(
      annotate({
        triage: triageOf([["src/core/a.ts", "strict"]]),
        verdict: verdictOf(
          result("correctness", "block", { status: "errored", detail: "timed out" }),
        ),
        coverage: [covering("correctness", "src/core/a.ts")],
      }),
    );
    expect(body).toContain("NOT");
    expect(body).toContain("correctness");
  });

  it("renders an empty change without pretending anything was verified", () => {
    const body = renderBody(annotate({ triage: triageOf([]), verdict: verdictOf(), coverage: [] }));
    expect(body).toContain("no files");
  });

  it("attaches the LLM prose to the 🔴 row, and nowhere else", () => {
    const body = renderBody(mixed(), {
      prose: new Map([
        ["src/core/gate/run.ts", "The receipt is written before the check outcome is known."],
        ["src/core/gate/select.ts", "PROSE THAT MUST NOT APPEAR"],
      ]),
    });
    expect(body).toContain("The receipt is written before");
    expect(body).not.toContain("PROSE THAT MUST NOT APPEAR");
  });
});

describe("upsertManagedBlock — running twice must not duplicate", () => {
  const block = renderBody(mixed());

  it("appends to a body that has no block yet, keeping the author's text", () => {
    const out = upsertManagedBlock("My PR description.", block);
    expect(out).toContain("My PR description.");
    expect(out).toContain(BODY_START);
  });

  it("REPLACES an existing block rather than appending a second", () => {
    const once = upsertManagedBlock("Mine.", block);
    const twice = upsertManagedBlock(once, block);
    expect(twice).toBe(once);
    expect(twice.split(BODY_START)).toHaveLength(2);
  });

  it("replaces a STALE block, and preserves text on both sides of it", () => {
    const stale = upsertManagedBlock("Before.", `${BODY_START}\nold\n${BODY_END}`);
    const fresh = upsertManagedBlock(`${stale}\n\nAfter.`, block);
    expect(fresh).toContain("Before.");
    expect(fresh).toContain("After.");
    expect(fresh).not.toContain("\nold\n");
    expect(fresh.split(BODY_START)).toHaveLength(2);
  });

  it("handles an empty existing body", () => {
    expect(upsertManagedBlock("", block)).toContain(BODY_START);
  });
});

describe("inlineComments", () => {
  const comments = inlineComments(mixed());

  it("comments ONLY on 🔴 — a skim marker is not worth a notification", () => {
    expect(comments.map((c) => c.path)).toEqual(["src/core/gate/run.ts"]);
  });

  it("anchors on the line the finding named, on the RIGHT side of the diff", () => {
    expect(comments[0]?.line).toBe(112);
    expect(comments[0]?.side).toBe("RIGHT");
  });

  it("carries a fingerprint in the body so a re-run can recognise its own comment", () => {
    expect(comments[0]?.body).toContain(comments[0]?.fingerprint ?? "");
  });

  it("omits `line` entirely when the finding gave none — GitHub rejects a null line", () => {
    const fileLevel = inlineComments(
      annotate({
        triage: triageOf([["src/core/a.ts", "strict"]]),
        verdict: verdictOf(
          result("t", "block", { status: "fail", detail: "src/core/a.ts is wrong" }),
        ),
        coverage: [covering("t", "src/core/a.ts")],
      }),
    );
    expect(fileLevel[0]).not.toHaveProperty("line");
    expect(fileLevel[0]?.subject_type).toBe("file");
  });

  it("includes the prose when there is prose", () => {
    const withProse = inlineComments(mixed(), new Map([["src/core/gate/run.ts", "Because X."]]));
    expect(withProse[0]?.body).toContain("Because X.");
  });

  it("is deterministic", () => {
    expect(inlineComments(mixed())).toEqual(inlineComments(mixed()));
  });
});

describe("reviewSummary + shouldPostReview — idempotency for the review itself", () => {
  it("carries a digest of the whole annotation in its body", () => {
    const summary = reviewSummary(mixed());
    expect(summary.body).toContain(summary.digest);
    expect(summary.event).toBe("REQUEST_CHANGES");
  });

  it("posts when the PR has no whetstone review yet", () => {
    expect(shouldPostReview(reviewSummary(mixed()).digest, [])).toBe(true);
  });

  it("does NOT post the same review twice", () => {
    const summary = reviewSummary(mixed());
    expect(shouldPostReview(summary.digest, [{ body: summary.body }])).toBe(false);
  });

  it("posts again once the annotation changes", () => {
    const before = reviewSummary(mixed());
    const after = reviewSummary(
      annotate({
        triage: triageOf([["src/core/gate/run.ts", "strict"]]),
        verdict: verdictOf(result("typecheck", "block", { status: "pass" })),
        coverage: [covering("typecheck", "src/core/gate/run.ts")],
      }),
    );
    expect(after.digest).not.toBe(before.digest);
    expect(shouldPostReview(after.digest, [{ body: before.body }])).toBe(true);
  });

  it("is not confused by a human's review", () => {
    const summary = reviewSummary(mixed());
    expect(shouldPostReview(summary.digest, [{ body: "looks good to me" }])).toBe(true);
  });
});

describe("fingerprint", () => {
  it("is stable for the same finding", () => {
    const f = { checkId: "typecheck", path: "src/a.ts", line: 3, detail: "boom" };
    expect(fingerprint(f)).toBe(fingerprint({ ...f }));
  });

  it("differs when the line, the file, the check or the detail differ", () => {
    const f = { checkId: "typecheck", path: "src/a.ts", line: 3, detail: "boom" };
    expect(fingerprint({ ...f, line: 4 })).not.toBe(fingerprint(f));
    expect(fingerprint({ ...f, path: "src/b.ts" })).not.toBe(fingerprint(f));
    expect(fingerprint({ ...f, checkId: "test" })).not.toBe(fingerprint(f));
    expect(fingerprint({ ...f, detail: "bang" })).not.toBe(fingerprint(f));
  });
});

describe("pruneAlreadyPosted — the idempotency rule", () => {
  const comments = inlineComments(mixed());

  it("keeps everything when the PR has no whetstone comments yet", () => {
    expect(pruneAlreadyPosted(comments, [])).toEqual(comments);
  });

  it("drops a comment whose fingerprint is already on the PR", () => {
    const existing = [{ body: `already said this ${comments[0]?.fingerprint ?? ""}` }];
    expect(pruneAlreadyPosted(comments, existing)).toEqual([]);
  });

  it("ignores unrelated human comments", () => {
    expect(pruneAlreadyPosted(comments, [{ body: "nit: rename this" }])).toEqual(comments);
  });

  it("re-posts when the finding changed, because the fingerprint changed", () => {
    const other = inlineComments(
      annotate({
        triage: triageOf([["src/core/gate/run.ts", "strict"]]),
        verdict: verdictOf(
          result("typecheck", "block", {
            status: "fail",
            detail: "src/core/gate/run.ts:999:1 - error TS9999",
          }),
        ),
        coverage: [covering("typecheck", "src/core/gate/run.ts")],
      }),
    );
    const existing = [{ body: `stale ${comments[0]?.fingerprint ?? ""}` }];
    expect(pruneAlreadyPosted(other, existing)).toEqual(other);
  });
});
