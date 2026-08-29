import { describe, expect, it } from "vitest";
import { answerableHere, EVIDENCE_PREFIX } from "./environment.js";

const check = (id: string) => ({ id }) as never;

describe("answerableHere — a check whose answer does not exist on this machine", () => {
  it("keeps every ordinary check, whatever the flag says", () => {
    for (const id of ["typecheck", "test", "correctness", "docs-fresh"]) {
      expect(answerableHere(check(id), { noEvidence: true })).toBe(true);
    }
  });

  it("drops an evidence check when the caller says this machine has no store", () => {
    // The store is local by design. An ephemeral runner has none, and its mtimes
    // say nothing about when anything was made, so the check cannot answer there
    // and no edit could make it.
    expect(answerableHere(check("evidence-launcher"), { noEvidence: true })).toBe(false);
  });

  it("keeps an evidence check by default, which is where a human is", () => {
    expect(answerableHere(check("evidence-launcher"), {})).toBe(true);
    expect(answerableHere(check("evidence-launcher"), { noEvidence: false })).toBe(true);
  });

  it("keys on the prefix the check files already use, not on a new field", () => {
    expect(EVIDENCE_PREFIX).toBe("evidence-");
    expect(answerableHere(check("evidence-anything-at-all"), { noEvidence: true })).toBe(false);
  });

  it("does not drop a check that merely mentions evidence somewhere in its id", () => {
    expect(answerableHere(check("no-evidence-needed"), { noEvidence: true })).toBe(true);
  });
});
