import { describe, expect, it } from "vitest";
import { validateRecommendation, type Recommendation } from "./propose.js";
import type { Signal } from "./cluster.js";

const log: Signal[] = [
  { id: "sig-0001", ts: "", type: "t", phase: "apply", severity: "high", detail: "real" },
  { id: "sig-0002", ts: "", type: "t", phase: "apply", severity: "high", detail: "real" },
];

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  clusterKey: "type:t",
  kind: "amend",
  target: ".wst/skills/voice.md",
  summary: "strengthen V2 to cover sub-agent output",
  rationale:
    "Two signals show a claim asserted without verification, both times from a sub-agent " +
    "whose output was trusted rather than checked against the repo.",
  citedSignals: ["sig-0001", "sig-0002"],
  ...over,
});

describe("validateRecommendation — the anti-poisoning gate", () => {
  it("accepts a well-formed recommendation", () => {
    expect(validateRecommendation(rec(), log).ok).toBe(true);
  });

  // THE CORE OF THE GATE. The proposal is agent-generated, so a hallucinated
  // signal id must never reach a human who might rubber-stamp it.
  it("REJECTS a recommendation citing a signal that does not exist", () => {
    const r = validateRecommendation(rec({ citedSignals: ["sig-0001", "sig-9999"] }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/sig-9999/);
  });

  it("REJECTS a recommendation citing no signals at all", () => {
    // A rule with a receipt is earned; a rule without one is a guess.
    const r = validateRecommendation(rec({ citedSignals: [] }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/receipt|signal/i);
  });

  // The constitution is human-owned. The retro proposes rules; it never rewrites
  // the document that says what the rules may be.
  it("REFUSES to touch the constitution", () => {
    const r = validateRecommendation(rec({ target: ".wst/constitution.md" }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/constitution/i);
  });

  it("REFUSES to touch anything outside .wst/", () => {
    const r = validateRecommendation(rec({ target: "src/core/gate/aggregate.ts" }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/\.wst/);
  });

  it("REJECTS an empty rationale — an unexplained rule cannot be reviewed", () => {
    expect(validateRecommendation(rec({ rationale: "  " }), log).ok).toBe(false);
  });

  it("reports EVERY reason at once rather than only the first", () => {
    const r = validateRecommendation(
      rec({ target: ".wst/constitution.md", citedSignals: ["sig-9999"], rationale: "" }),
      log,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("allows an ADR flip, since ADR-0007 makes decisions retro-amendable", () => {
    const r = validateRecommendation(
      rec({ kind: "flip-adr", target: ".wst/memory/decisions/0004-x.md" }),
      log,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a signal cited twice — duplicate citations inflate the evidence", () => {
    const r = validateRecommendation(rec({ citedSignals: ["sig-0001", "sig-0001"] }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/duplicate/i);
  });
});

describe("validateRecommendation — unreviewable proposals", () => {
  // From the first real retro: three of four proposals came back as the literal
  // word "placeholder" and the gate forwarded them to a human. Empty is not the
  // only way to be unreviewable.
  it("REJECTS a placeholder rationale", () => {
    const r = validateRecommendation(rec({ rationale: "placeholder" }), log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toMatch(/placeholder/i);
  });

  it("REJECTS a placeholder summary", () => {
    expect(validateRecommendation(rec({ summary: "Placeholder — need to look first" }), log).ok)
      .toBe(false);
  });

  it("REJECTS a rationale too thin to evaluate", () => {
    expect(validateRecommendation(rec({ rationale: "seems bad" }), log).ok).toBe(false);
  });

  it("still accepts a real rationale of reasonable length", () => {
    expect(validateRecommendation(rec(), log).ok).toBe(true);
  });
});
