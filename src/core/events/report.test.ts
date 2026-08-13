/**
 * Rendering a run. Written before `report.ts` — `src/core/**` is strict tier.
 *
 * These are not cosmetic assertions. `core/gate/report.ts` states the rule the whole
 * output layer of this project answers to — *"never let a reader conclude 'verified'
 * from something that was not"* — and a run's timeline is the newest place that rule
 * can be broken. Three of the cases below exist only to hold it: a `run-failed` may
 * not read like a `run-finished`, a run that ended on exit 2 may not read as a pass,
 * and a run that never wrote a terminal line may not read as either.
 */

import { describe, expect, it } from "vitest";
import type { EventKind, EventRecord } from "./record.js";
import {
  noRunsMessage,
  renderEntryLines,
  renderRunEnding,
  renderRunHeader,
  renderRunList,
  renderRunTimeline,
  runReading,
} from "./report.js";
import { summariseRuns } from "./timeline.js";

const ev = (
  seq: number,
  kind: EventKind,
  extra: Partial<EventRecord> = {},
): EventRecord => ({
  run: "run-b7e3e5ad",
  seq,
  ts: new Date(Date.parse("2026-08-12T18:42:21.186Z") + seq * 1000).toISOString(),
  kind,
  detail: kind,
  ...extra,
});

const one = (records: EventRecord[]): string => {
  const [summary] = summariseRuns(records);
  if (summary === undefined) throw new Error("the fixture produced no run");
  return renderRunTimeline(summary);
};

const passed = [
  ev(0, "run-started", { detail: "wst gate --range origin/main..HEAD" }),
  ev(1, "triage-classified", { detail: "11 file(s) classified as strict", tier: "strict" }),
  ev(2, "check-finished", { detail: "`typecheck` (v1) pass", check: "typecheck", status: "pass", ms: 2755 }),
  ev(3, "run-finished", { detail: "passed — 3 check(s), 0 errored", status: "pass", exit: 0 }),
];

describe("renderRunTimeline", () => {
  it("names the run and the number of events it holds", () => {
    const out = one(passed);
    expect(out).toContain("run-b7e3e5ad");
    expect(out).toContain("4 events");
  });

  it("counts a single event as one event", () => {
    expect(one([ev(0, "run-started")])).toMatch(/1 event$/m);
  });

  it("prints no event count for a run being followed, because it goes stale mid-tail", () => {
    // Observed on the first live tail: the header said "1 events" and four more
    // lines then streamed under it. A number that is wrong by the time the next
    // line lands is worse than no number.
    const [summary] = summariseRuns(passed);
    if (summary === undefined) throw new Error("the fixture produced no run");
    const header = renderRunHeader(summary, { following: true });
    expect(header).not.toMatch(/\d+ events?/);
    expect(header).toMatch(/following/);
  });

  it("times each event from the start of the run, not by wall clock", () => {
    // The absolute timestamps are in the file already. What the file cannot show at
    // a glance is the SHAPE of the run — where the seconds went.
    const out = one(passed);
    expect(out).toContain("+0.000s");
    expect(out).toContain("+2.000s");
  });

  it("gives each check its own duration, so a slow one is visible", () => {
    expect(one(passed)).toMatch(/typecheck.*2\.8s/);
  });

  it("says a passing run passed, with the exit code it exited on", () => {
    const out = one(passed);
    expect(out).toContain("passed");
    expect(out).toContain("exit 0");
  });

  it("renders a blocked run as BLOCKED and never as passed", () => {
    const out = one([
      ev(0, "run-started", { detail: "wst gate --range HEAD" }),
      ev(1, "run-finished", { detail: "blocked by test", status: "block", exit: 1 }),
    ]);
    expect(out).toContain("BLOCKED");
    expect(out).not.toMatch(/\bpassed\b/);
  });

  it("refuses to call a run that exited 2 a pass, whatever its own line says", () => {
    // The real log is full of these: `{"kind":"run-finished","detail":"passed — 0
    // check(s), 0 errored","status":"pass","exit":2}`. The gate's own wording there
    // is about the VERDICT object; exit 2 is `EXIT_INCOMPLETE`, and hard rule 3 says
    // a run that verified nothing may not share a word with one that did.
    const out = one([
      ev(0, "run-started", { detail: "wst gate --range origin/main..HEAD" }),
      ev(1, "run-finished", { detail: "passed — 0 check(s), 0 errored", status: "pass", exit: 2 }),
    ]);
    expect(out).toContain("INCOMPLETE");
    expect(out).toContain("exit 2");
    // The gate's own detail string is still shown on its line — this is a log
    // reader and it does not rewrite what was written. What it may not do is
    // CONCLUDE a pass from it.
    expect(out).not.toMatch(/^\s*passed\b/m);
  });

  it("renders a failed run as FAILED, and says no verdict was reached", () => {
    const out = one([
      ev(0, "run-started", { detail: "wst gate --range HEAD" }),
      ev(1, "run-failed", { detail: "configuration failed to load", exit: 2 }),
    ]);
    expect(out).toContain("FAILED");
    expect(out).toContain("configuration failed to load");
    expect(out).not.toMatch(/\bpassed\b/);
    // A broken gate is not a judgment on the change. The reader has to be told
    // which of the two they are looking at.
    expect(out).toMatch(/not a verdict|no verdict/i);
  });

  it("says plainly that a run with no terminal line has not ended", () => {
    const out = one([
      ev(0, "run-started", { detail: "wst gate --range HEAD" }),
      ev(1, "check-finished", { detail: "`test` (v1) pass", check: "test", status: "pass", ms: 26467 }),
    ]);
    expect(out).toMatch(/NO END RECORDED/);
    // Not "contains no `passed` anywhere": the honest sentence for this state is
    // itself a DENIAL of a pass, and a check that forbids the word would push the
    // render toward saying less. What must not appear is a line that ASSERTS one.
    expect(out).not.toMatch(/^\s*passed\b/m);
    expect(out).toMatch(/nothing here says it passed/);
    // Still going and killed halfway leave the same log. Claiming either would be
    // an invention.
    expect(out).toMatch(/still running|still going/i);
  });

  it("shows a receipt skip as the log worded it, rather than inventing a reason", () => {
    const out = one([
      ev(0, "run-started", { detail: "wst gate --range HEAD" }),
      ev(1, "check-skipped", {
        detail: "`test` skipped — a receipt covers this input",
        check: "test",
        status: "skipped",
      }),
    ]);
    expect(out).toContain("a receipt covers this input");
  });

  it("prints a placeholder rather than NaN when a timestamp will not parse", () => {
    const out = one([
      { ...ev(0, "run-started"), ts: "not a date" },
      ev(1, "run-finished", { status: "pass", exit: 0 }),
    ]);
    expect(out).not.toContain("NaN");
  });
});

describe("renderRunList", () => {
  const list = (): string =>
    renderRunList(
      summariseRuns([
        { ...ev(0, "run-started"), run: "run-old", ts: "2026-08-12T10:00:00.000Z" },
        { ...ev(1, "run-finished", { status: "pass", exit: 0 }), run: "run-old", ts: "2026-08-12T10:00:01.000Z" },
        { ...ev(0, "run-started"), run: "run-new", ts: "2026-08-12T18:00:00.000Z" },
        { ...ev(1, "run-failed", { detail: "the diff could not be read", exit: 2 }), run: "run-new", ts: "2026-08-12T18:00:02.000Z" },
        { ...ev(0, "run-started"), run: "run-open", ts: "2026-08-12T14:00:00.000Z" },
      ]),
    );

  it("puts the newest run first, because that is the one being asked about", () => {
    const ids = list()
      .split("\n")
      .filter((l) => l.includes("run-"))
      .map((l) => (/run-[a-z0-9]+/.exec(l) ?? [""])[0]);
    expect(ids).toEqual(["run-new", "run-open", "run-old"]);
  });

  it("gives one line per run: id, when, how many events, how it ended", () => {
    const line = list()
      .split("\n")
      .find((l) => l.includes("run-old")) as string;
    expect(line).toContain("2026-08-12");
    expect(line).toContain("2 events");
    expect(line).toContain("passed");
  });

  it("keeps the three endings distinguishable at a glance", () => {
    const out = list();
    const lineFor = (id: string): string =>
      out.split("\n").find((l) => l.includes(id)) as string;
    expect(lineFor("run-new")).toContain("FAILED");
    expect(lineFor("run-new")).not.toMatch(/passed/);
    expect(lineFor("run-open")).toContain("NO END RECORDED");
    expect(lineFor("run-old")).toContain("passed");
  });

  it("counts the runs it is showing", () => {
    expect(list()).toContain("3 runs");
  });
});

describe("the pieces `--follow` prints one at a time", () => {
  it("compose into exactly what the one-shot render produces", () => {
    // `--follow` cannot call `renderRunTimeline`: it prints the header once, then a
    // line per event as it lands, then the ending. That is a SECOND rendering path,
    // and a second path is where the two outputs start to disagree — which for this
    // command means a tailed run and a read-back run describing the same events
    // differently. Pinning them to the same pieces is what stops that.
    const [summary] = summariseRuns(passed);
    if (summary === undefined) throw new Error("the fixture produced no run");
    const streamed = [
      renderRunHeader(summary),
      ...summary.events.flatMap((e) => renderEntryLines(e, summary.ending)),
      ...renderRunEnding(summary),
    ].join("\n");
    expect(streamed).toBe(renderRunTimeline(summary));
  });
});

describe("runReading", () => {
  it("names the ending for a consumer that must not re-derive it from `status`", () => {
    // What `--json` publishes. A caller left to read `status: "pass"` next to
    // `exit: 2` will conclude the run passed, which is the same mistake in a
    // different language.
    const reading = (records: EventRecord[]): string => {
      const [summary] = summariseRuns(records);
      if (summary === undefined) throw new Error("the fixture produced no run");
      return runReading(summary.ending);
    };
    expect(reading(passed)).toBe("passed");
    expect(reading([ev(0, "run-finished", { status: "pass", exit: 2 })])).toBe("incomplete");
    expect(reading([ev(0, "run-finished", { status: "block", exit: 1 })])).toBe("blocked");
    expect(reading([ev(0, "run-failed", { detail: "broke", exit: 2 })])).toBe("failed");
    expect(reading([ev(0, "run-started")])).toBe("unterminated");
  });
});

describe("noRunsMessage", () => {
  it("is a statement of fact, not an error", () => {
    // An empty log is what a repo that has not run the gate yet looks like. It is
    // also what a repo whose log was deleted looks like, and neither is a fault.
    const message = noRunsMessage(".wst/events.jsonl");
    expect(message).toContain("no runs recorded yet");
    expect(message).toContain(".wst/events.jsonl");
  });
});
