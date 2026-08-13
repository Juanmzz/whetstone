/**
 * The reader's half of the log. Written before `timeline.ts` exists: `src/core/**`
 * is strict tier, so the failing test comes first.
 *
 * What is being pinned here is not formatting — that is `report.test.ts` — but the
 * three facts a reader of a run needs and cannot get from the raw lines: which
 * events belong to one run, in what order they happened, and HOW THE RUN ENDED. The
 * third is the one with teeth: a run that never wrote a terminal line and a run that
 * finished must not collapse into the same answer, because the collapse is what lets
 * a reader conclude "it passed" from a log that says nothing of the kind.
 */

import { describe, expect, it } from "vitest";
import type { EventKind, EventRecord } from "./record.js";
import {
  completeLinePrefix,
  entriesAfter,
  lookupRun,
  summariseRuns,
} from "./timeline.js";

/** One line, with only the fields a case is about spelled out. */
const ev = (
  run: string,
  seq: number,
  kind: EventKind,
  extra: Partial<EventRecord> = {},
): EventRecord => ({
  run,
  seq,
  ts: `2026-08-12T14:00:0${seq}.000Z`,
  kind,
  detail: kind,
  ...extra,
});

describe("summariseRuns", () => {
  it("groups the lines of one run together and leaves the other run alone", () => {
    const runs = summariseRuns([
      ev("run-a", 0, "run-started"),
      ev("run-b", 0, "run-started"),
      ev("run-a", 1, "run-finished"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.run).sort()).toEqual(["run-a", "run-b"]);
    expect(runs.find((r) => r.run === "run-a")?.eventCount).toBe(2);
  });

  it("orders a run's events by `seq`, not by where they landed in the file", () => {
    // Two worktrees appending at once interleave whole lines. `seq` is the total
    // order within a run precisely so that interleaving does not become a reordering.
    const [run] = summariseRuns([
      ev("run-a", 2, "run-finished"),
      ev("run-a", 0, "run-started"),
      ev("run-a", 1, "triage-classified"),
    ]);
    expect(run?.events.map((e) => e.event.seq)).toEqual([0, 1, 2]);
  });

  it("orders the runs newest first", () => {
    const runs = summariseRuns([
      { ...ev("run-old", 0, "run-started"), ts: "2026-08-12T10:00:00.000Z" },
      { ...ev("run-new", 0, "run-started"), ts: "2026-08-12T18:00:00.000Z" },
      { ...ev("run-mid", 0, "run-started"), ts: "2026-08-12T14:00:00.000Z" },
    ]);
    expect(runs.map((r) => r.run)).toEqual(["run-new", "run-mid", "run-old"]);
  });

  it("times every event from the start of its own run", () => {
    const [run] = summariseRuns([
      { ...ev("run-a", 0, "run-started"), ts: "2026-08-12T14:00:00.000Z" },
      { ...ev("run-a", 1, "check-finished"), ts: "2026-08-12T14:00:02.750Z" },
    ]);
    expect(run?.events.map((e) => e.offsetMs)).toEqual([0, 2750]);
  });

  it("reports a finished run's status and exit code, taken from the line itself", () => {
    const [run] = summariseRuns([
      ev("run-a", 0, "run-started"),
      ev("run-a", 1, "run-finished", { detail: "passed — 3 check(s)", status: "pass", exit: 0 }),
    ]);
    expect(run?.ending).toEqual({
      kind: "finished",
      detail: "passed — 3 check(s)",
      status: "pass",
      exit: 0,
    });
  });

  it("keeps a failed run distinguishable from a finished one", () => {
    // The whole point of the two kinds. `run-failed` means the gate broke — no
    // verdict was reached — and anything that folds it into `run-finished` is
    // telling a reader a change was judged when it was not.
    const [run] = summariseRuns([
      ev("run-a", 0, "run-started"),
      ev("run-a", 1, "run-failed", { detail: "configuration failed to load", exit: 2 }),
    ]);
    expect(run?.ending.kind).toBe("failed");
  });

  it("calls a run with no terminal line unterminated rather than guessing", () => {
    // A process killed mid-run and a process still running leave the SAME log. The
    // reader is entitled to know that neither of them ended.
    const [run] = summariseRuns([ev("run-a", 0, "run-started"), ev("run-a", 1, "check-finished")]);
    expect(run?.ending.kind).toBe("unterminated");
    expect(run?.endedAt).toBeNull();
    expect(run?.durationMs).toBeNull();
  });

  it("measures wall time from the first line to the terminal one", () => {
    const [run] = summariseRuns([
      { ...ev("run-a", 0, "run-started"), ts: "2026-08-12T14:00:00.000Z" },
      { ...ev("run-a", 1, "run-finished"), ts: "2026-08-12T14:00:26.640Z" },
    ]);
    expect(run?.durationMs).toBe(26640);
    expect(run?.startedAt).toBe("2026-08-12T14:00:00.000Z");
    expect(run?.endedAt).toBe("2026-08-12T14:00:26.640Z");
  });

  it("answers `null` for a timing it cannot compute, never `NaN`", () => {
    // `parseEventLog` checks that `ts` is a string, not that it is a date, so a
    // foreign or hand-made log can carry one that will not parse. `NaN` renders as
    // "NaNms", which reads like a measurement.
    const [run] = summariseRuns([
      { ...ev("run-a", 0, "run-started"), ts: "not a date" },
      { ...ev("run-a", 1, "run-finished"), ts: "2026-08-12T14:00:01.000Z" },
    ]);
    expect(run?.events.map((e) => e.offsetMs)).toEqual([null, null]);
    expect(run?.durationMs).toBeNull();
  });

  it("returns nothing at all for an empty log", () => {
    expect(summariseRuns([])).toEqual([]);
  });
});

describe("lookupRun", () => {
  const runs = summariseRuns([
    ev("run-b7e3e5ad", 0, "run-started"),
    ev("run-b7e30000", 0, "run-started"),
    ev("run-95c523e2", 0, "run-started"),
  ]);

  it("finds a run by its whole id", () => {
    const found = lookupRun(runs, "run-95c523e2");
    expect(found.kind === "found" && found.summary.run).toBe("run-95c523e2");
  });

  it("finds a run by an unambiguous prefix", () => {
    // The id is a hash printed at the end of a gate run, and a copy off a wrapped
    // terminal line is routinely a fragment of one.
    const found = lookupRun(runs, "run-95c5");
    expect(found.kind === "found" && found.summary.run).toBe("run-95c523e2");
  });

  it("refuses a prefix that matches two runs, and names both", () => {
    const found = lookupRun(runs, "run-b7e3");
    expect(found.kind).toBe("ambiguous");
    expect(found.kind === "ambiguous" && [...found.matches].sort()).toEqual([
      "run-b7e30000",
      "run-b7e3e5ad",
    ]);
  });

  it("says unknown rather than silently falling back to the newest run", () => {
    // Falling back would answer a question about run X with run Y's timeline, which
    // is worse than an error: the output looks exactly like a correct answer.
    expect(lookupRun(runs, "run-nope").kind).toBe("unknown");
  });
});

describe("entriesAfter", () => {
  const [run] = summariseRuns([
    ev("run-a", 0, "run-started"),
    ev("run-a", 1, "check-finished"),
    ev("run-a", 2, "run-finished"),
  ]);

  it("returns only what a follower has not printed yet", () => {
    expect(entriesAfter(run!, 0).map((e) => e.event.seq)).toEqual([1, 2]);
  });

  it("returns everything when nothing has been printed", () => {
    expect(entriesAfter(run!, -1)).toHaveLength(3);
  });

  it("returns nothing when the follower is up to date", () => {
    expect(entriesAfter(run!, 2)).toEqual([]);
  });
});

describe("completeLinePrefix", () => {
  it("drops a trailing fragment that has no newline yet", () => {
    // For `--follow` only. A read that lands mid-append sees half a line, and
    // handing that half to `parseEventLog` would report a corrupt log for what is
    // in fact a write still in flight.
    expect(completeLinePrefix('{"a":1}\n{"b":2')).toBe('{"a":1}\n');
  });

  it("leaves a log that ends on a newline untouched", () => {
    expect(completeLinePrefix('{"a":1}\n')).toBe('{"a":1}\n');
  });

  it("returns nothing when not one line is complete", () => {
    expect(completeLinePrefix('{"a":1')).toBe("");
  });
});
