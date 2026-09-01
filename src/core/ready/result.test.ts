import { describe, expect, it } from "vitest";
import { EXIT_INCOMPLETE, EXIT_NOT_READY, EXIT_READY, exitFor, readinessOf, saidAs } from "./result.js";

describe("readinessOf — the gate's outcome as an answer to `is this ready`", () => {
  it("is READY when something ran and everything passed", () => {
    expect(readinessOf("passed", true)).toBe("READY");
  });

  it("is NOT_READY only for a real check failure", () => {
    expect(readinessOf("blocked", true)).toBe("NOT_READY");
  });

  it("is INCOMPLETE when a check could not run, never NOT_READY", () => {
    // The gate being broken is not a verdict on the change. Reporting it as one
    // sends an agent to fix code that was never the problem.
    expect(readinessOf("incomplete", true)).toBe("INCOMPLETE");
  });

  it("is INCOMPLETE when nothing covered the change", () => {
    // `gate` exits 0 here on purpose (adr-0021): a hook that blocks a markdown
    // commit teaches `--no-verify`. `ready` answers a different question, and a run
    // that verified nothing has not established readiness.
    expect(readinessOf("uncovered", true)).toBe("INCOMPLETE");
  });

  it("is NO_CHANGES when the scope held nothing, whatever the gate said", () => {
    for (const outcome of ["passed", "uncovered"] as const) {
      expect(readinessOf(outcome, false)).toBe("NO_CHANGES");
    }
  });
});

describe("exitFor — the number, which is protocol and not product language", () => {
  it("keeps the three-code contract shells and CI already read", () => {
    expect(exitFor("READY")).toBe(EXIT_READY);
    expect(exitFor("NOT_READY")).toBe(EXIT_NOT_READY);
    expect(exitFor("INCOMPLETE")).toBe(EXIT_INCOMPLETE);
  });

  it("does not fail a run that had nothing to verify", () => {
    // Exit 0 for the same reason adr-0021 gives: there is no edit that makes an
    // empty change verifiable, and a code nobody can satisfy gets routed around.
    // The semantic field is what stops it reading as `READY`.
    expect(exitFor("NO_CHANGES")).toBe(EXIT_READY);
  });
});

describe("saidAs — what a person is told", () => {
  it("gives each result a sentence, and none of them is a number", () => {
    const said = (["READY", "NOT_READY", "INCOMPLETE", "NO_CHANGES"] as const).map(saidAs);
    expect(said).toEqual(["Ready", "Needs work", "Verification incomplete", "No changes to verify"]);
    for (const s of said) expect(s).not.toMatch(/exit|\b[012]\b/);
  });

  it("never says NO_CHANGES passed, which is the one misreading that matters", () => {
    expect(saidAs("NO_CHANGES").toLowerCase()).not.toContain("pass");
    expect(saidAs("NO_CHANGES")).not.toBe(saidAs("READY"));
  });
});
