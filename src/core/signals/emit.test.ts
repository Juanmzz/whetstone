import { describe, expect, it } from "vitest";
import { dedupe, signalsFromGate, type EmittableSignal } from "./emit.js";
import type { CheckOutcome, CheckResult, GateVerdict } from "../contracts.js";
import { aggregate } from "../gate/aggregate.js";

const result = (id: string, sev: CheckResult["severity"], outcome: CheckOutcome): CheckResult => ({
  checkId: id,
  checkVersion: 1,
  severity: sev,
  outcome,
  durationMs: 1,
});
const verdict = (...r: CheckResult[]): GateVerdict => aggregate(r);

describe("signalsFromGate", () => {
  it("emits nothing when everything passed", () => {
    // The common case by far. A log that records success is a log nobody reads.
    expect(signalsFromGate(verdict(result("test", "block", { status: "pass" })), "a..b")).toEqual([]);
  });

  it("emits nothing for a skipped check", () => {
    const v = verdict(result("test", "block", { status: "skipped", reason: "receipt" }));
    expect(signalsFromGate(v, "a..b")).toEqual([]);
  });

  it("emits when a blocking check actually failed", () => {
    const v = verdict(result("test", "block", { status: "fail", detail: "2 tests failed" }));
    const [s] = signalsFromGate(v, "a..b");
    expect(s?.type).toBe("gate-blocked");
    expect(s?.detail).toContain("test");
  });

  // The class of signal I have been failing to log by hand, which is the whole
  // reason the engine should be doing it.
  it("emits when a check could NOT RUN, and marks it distinctly", () => {
    const v = verdict(result("correctness", "warn", { status: "errored", detail: "budget" }));
    const [s] = signalsFromGate(v, "a..b");
    expect(s?.type).toBe("check-could-not-run");
    expect(s?.severity).toBe("high");
  });

  it("does not emit for an advisory check that merely failed", () => {
    // A warn-level finding is the lens doing its job, not friction. Logging every
    // one would drown the retro in the ordinary.
    const v = verdict(result("correctness", "warn", { status: "fail", detail: "maybe a bug" }));
    expect(signalsFromGate(v, "a..b")).toEqual([]);
  });

  it("marks every emitted signal as machine-authored", () => {
    const v = verdict(result("test", "block", { status: "fail", detail: "boom" }));
    expect(signalsFromGate(v, "a..b")[0]?.source).toBe("gate");
  });

  it("emits one signal per failing check, not one per run", () => {
    const v = verdict(
      result("test", "block", { status: "fail", detail: "a" }),
      result("typecheck", "block", { status: "fail", detail: "b" }),
    );
    expect(signalsFromGate(v, "a..b")).toHaveLength(2);
  });
});

const sig = (fingerprint: string): EmittableSignal => ({
  type: "gate-blocked",
  phase: "verify",
  severity: "medium",
  detail: "d",
  source: "gate",
  fingerprint,
});

describe("dedupe", () => {
  it("keeps a signal the log has never seen", () => {
    expect(dedupe([sig("x")], [])).toHaveLength(1);
  });

  /**
   * THE POISONING VECTOR THIS EXISTS TO CLOSE. Running the gate five times while
   * fixing one failure would append five identical signals. The retro clusters on
   * recurrence, so that turns "how many times someone re-ran the gate" into
   * evidence, and a rule would be proposed on the strength of an impatient loop.
   */
  it("drops a signal whose fingerprint is already in the log UNRESOLVED", () => {
    expect(dedupe([sig("x")], [{ fingerprint: "x" }])).toEqual([]);
  });

  it("re-emits once the earlier one was RESOLVED — the problem came back", () => {
    // A regression is real news, and the receipt proves the earlier one was closed.
    expect(dedupe([sig("x")], [{ fingerprint: "x", resolved_by: "skills/a.md@v2" }])).toHaveLength(1);
  });

  it("keeps distinct fingerprints apart", () => {
    expect(dedupe([sig("x"), sig("y")], [{ fingerprint: "x" }])).toHaveLength(1);
  });

  it("dedupes within a single batch too", () => {
    expect(dedupe([sig("x"), sig("x")], [])).toHaveLength(1);
  });

  it("ignores hand-written signals that carry no fingerprint", () => {
    expect(dedupe([sig("x")], [{ detail: "a human wrote this" } as never])).toHaveLength(1);
  });
});
