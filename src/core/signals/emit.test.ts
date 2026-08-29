import { describe, expect, it } from "vitest";
import {
  dedupe,
  gateSignalId,
  signalId,
  signalsFromGate,
  type EmittableSignal,
} from "./emit.js";
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

/**
 * IDS MUST NOT COME FROM A COUNTER.
 *
 * `shell/signals.ts` allocated `sig-NNNN` as `max(existing) + 1`, read from the log.
 * The file is append-only and says so — but the ID is not, and two gates running in
 * parallel worktrees both read the same log, both compute the same next number, and
 * both write it. The retro clusters over these IDs.
 *
 * The signal already carries a content identity: `fingerprint`, which `dedupe`
 * relies on. Deriving the ID from it needs no read, so there is nothing to race.
 */
describe("signalId", () => {
  it("is a pure function of the fingerprint", () => {
    expect(signalId("gate-blocked:test:1")).toBe(signalId("gate-blocked:test:1"));
  });

  it("differs for different fingerprints", () => {
    expect(signalId("gate-blocked:test:1")).not.toBe(signalId("gate-blocked:test:2"));
  });

  it("needs nothing but the fingerprint — no log, no counter, no clock", () => {
    // The whole point: two machines with different logs agree, so concurrent
    // writers cannot collide and a replay cannot renumber history.
    expect(signalId.length).toBe(1);
  });

  it("looks like a signal id, so existing tooling and prose still parse it", () => {
    expect(signalId("x")).toMatch(/^sig-[0-9a-f]{8}$/);
  });

  it("does not collide across a realistic spread of fingerprints", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(signalId(`gate-blocked:check-${String(i)}:1`));
    expect(ids.size).toBe(2000);
  });
});

/**
 * Three branches wrote `sig-afa2baff` on 2026-08-29: same check, same
 * fingerprint, different occurrences. `resolve.ts` finds by id, so only the
 * first could ever be answered.
 */
describe("gateSignalId — one id per occurrence, not per fingerprint", () => {
  const FP = "gate-blocked:evidence-launcher:1";

  it("gives two branches two ids for the same block", () => {
    const one = gateSignalId(FP, "2026-08-29T01:14:35.475Z", "fix/the-wordmark");
    const two = gateSignalId(FP, "2026-08-29T04:55:00.255Z", "feat/the-repo-answers");

    expect(one).not.toBe(two);
  });

  it("gives two runs on one branch two ids, because each block really happened", () => {
    expect(gateSignalId(FP, "2026-08-29T01:00:00.000Z", "b")).not.toBe(
      gateSignalId(FP, "2026-08-29T02:00:00.000Z", "b"),
    );
  });

  it("is still a pure function: no log read, so parallel writers cannot race", () => {
    expect(gateSignalId(FP, "2026-08-29T01:00:00.000Z", "b")).toBe(
      gateSignalId(FP, "2026-08-29T01:00:00.000Z", "b"),
    );
  });

  it("works where git could not name a branch", () => {
    expect(gateSignalId(FP, "2026-08-29T01:00:00.000Z", null)).toMatch(/^sig-[0-9a-f]{8}$/);
  });

  it("still looks like a signal id, so the prose and the tooling parse it", () => {
    expect(gateSignalId(FP, "2026-08-29T01:00:00.000Z", "b")).toMatch(/^sig-[0-9a-f]{8}$/);
  });

  it("does not collide across a run of blocks a real repo would produce", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const branch of ["a", "b", "c", null]) {
        ids.add(gateSignalId(FP, new Date(Date.UTC(2026, 7, 29, 0, i)).toISOString(), branch));
      }
    }
    expect(ids.size).toBe(2000);
  });

  it("leaves the fingerprint alone, which is what dedupe still reasons over", () => {
    expect(gateSignalId(FP, "2026-08-29T01:00:00.000Z", "b")).not.toContain(FP);
  });
});
