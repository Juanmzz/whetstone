/**
 * DRAFT — encodes the PROPOSED event schema, pending a human signature.
 *
 * The pure half of the event log: identity, sequencing, and turning what a caller
 * observed into a record. No I/O — appending is `src/shell/events.ts`.
 */

import { describe, expect, it } from "vitest";
import { runId, toRecord } from "./record.js";

const NOW = new Date("2026-08-12T14:02:11.431Z");

describe("runId", () => {
  it("derives the id from the seed, so nothing has to be read to allocate one", () => {
    // Same lesson as `signalId`. A counter read from the log is a
    // read-modify-write, and two gates in parallel worktrees compute the same
    // next number and both write it.
    expect(runId("gate|origin/main..HEAD|2026-08-12T14:02:11.431Z")).toBe(
      runId("gate|origin/main..HEAD|2026-08-12T14:02:11.431Z"),
    );
  });

  it("gives two runs of the same command at different times different ids", () => {
    expect(runId("gate|HEAD|2026-08-12T14:02:11.431Z")).not.toBe(
      runId("gate|HEAD|2026-08-12T14:02:12.000Z"),
    );
  });

  it("is greppable and fixed-width", () => {
    expect(runId("anything")).toMatch(/^run-[0-9a-f]{8}$/);
  });
});

describe("toRecord", () => {
  it("stamps the caller's observation with run, seq and time", () => {
    const record = toRecord("run-a3f1c2d4", 0, NOW, {
      kind: "run-started",
      detail: "wst gate --range origin/main..HEAD --no-lens",
    });
    expect(record).toEqual({
      run: "run-a3f1c2d4",
      seq: 0,
      ts: "2026-08-12T14:02:11.431Z",
      kind: "run-started",
      detail: "wst gate --range origin/main..HEAD --no-lens",
    });
  });

  it("omits an absent optional field rather than writing it null", () => {
    // Same rule as `SignalRecord.branch`: `null` reads as present-and-empty, and a
    // consumer cannot tell "this check reported no duration" from "durations were
    // not recorded when this line was written".
    const record = toRecord("run-a3f1c2d4", 1, NOW, { kind: "run-finished", detail: "passed" });
    expect(Object.keys(record)).not.toContain("ms");
    expect(Object.keys(record)).not.toContain("check");
  });

  it("carries the per-kind fields through", () => {
    const record = toRecord("run-a3f1c2d4", 2, NOW, {
      kind: "check-finished",
      detail: "`tests` passed",
      check: "tests",
      status: "pass",
      ms: 4120,
    });
    expect(record.check).toBe("tests");
    expect(record.status).toBe("pass");
    expect(record.ms).toBe(4120);
  });

  it("records a run that could not start, which today leaves no trace at all", () => {
    // The three `EXIT_MISCONFIGURED` returns in `commands/gate.ts` print to stderr
    // and vanish. Those are the runs where "the gate was broken, not the change"
    // has to be provable afterwards — rule 3 is only enforceable if the distinction
    // is recorded somewhere.
    const record = toRecord("run-a3f1c2d4", 1, NOW, {
      kind: "run-failed",
      detail: "configuration failed to load",
      exit: 2,
    });
    expect(record.kind).toBe("run-failed");
    expect(record.exit).toBe(2);
  });

  it("round-trips through the parser", () => {
    // The writer and the reader agree, or the log is write-only.
    const record = toRecord("run-a3f1c2d4", 0, NOW, { kind: "run-started", detail: "x" });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});
