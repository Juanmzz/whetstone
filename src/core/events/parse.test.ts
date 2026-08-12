/**
 * DRAFT — encodes the PROPOSED event schema, pending a human signature. The record
 * shape propagates into every bootstrapped repo via `init`, so it is signed before
 * it is implemented, not after.
 */

import { describe, expect, it } from "vitest";
import { EventLogParseError, parseEventLog } from "./parse.js";

const good = (seq: number, kind = "run-started"): string =>
  JSON.stringify({
    run: "run-a3f1c2d4",
    seq,
    ts: "2026-08-12T14:02:11.431Z",
    kind,
    detail: "wst gate --range origin/main..HEAD --no-lens",
  });

describe("parseEventLog", () => {
  it("reads every well-formed line of a log", () => {
    const parsed = parseEventLog(`${good(0)}\n${good(1, "run-finished")}\n`);
    expect(parsed.map((e) => e.kind)).toEqual(["run-started", "run-finished"]);
  });

  it("keeps a log that ends without a trailing newline", () => {
    // The writer always writes one. A log truncated by a crash mid-append is the
    // ordinary shape of the file this primitive exists to survive.
    expect(parseEventLog(good(0))).toHaveLength(1);
  });

  it("skips blank lines rather than calling them corrupt", () => {
    expect(parseEventLog(`\n${good(0)}\n\n  \n${good(1)}\n`)).toHaveLength(2);
  });

  it("keeps `seq` as a number, so ordering survives a same-millisecond write", () => {
    // Two events inside one millisecond are NORMAL for a deterministic check that
    // returns instantly. A log ordered only by `ts` cannot be replayed, and replay
    // is two of the three debts ADR-0011 says this primitive pays.
    expect(parseEventLog(good(7))[0]?.seq).toBe(7);
  });

  it("keeps the optional fields a consumer branches on", () => {
    const line = JSON.stringify({
      ...(JSON.parse(good(3, "check-finished")) as object),
      check: "tests",
      status: "pass",
      ms: 4120,
    });
    const [e] = parseEventLog(line);
    expect(e?.check).toBe("tests");
    expect(e?.status).toBe("pass");
    expect(e?.ms).toBe(4120);
  });

  it("throws rather than returning a subset when a line is not valid JSON", () => {
    // Same policy as `signals.jsonl`, for a different reason. There, a partial log
    // read as complete re-emits deduped signals. Here, a partial log read as
    // complete is a run that looks like it stopped where the corruption starts.
    expect(() => parseEventLog(`${good(0)}\n{"run": "x"\n`)).toThrow(/line 2/);
  });

  it("reports the line number of the corrupt line, not of the last one read", () => {
    expect(() => parseEventLog(`${good(0)}\n${good(1)}\nnot json\n${good(3)}\n`)).toThrow(
      /line 3/,
    );
  });

  it("throws on a line that is valid JSON but not an object", () => {
    for (const scalar of ["42", '"run-started"', "null", "[]"]) {
      expect(() => parseEventLog(`${good(0)}\n${scalar}\n`)).toThrow(EventLogParseError);
    }
  });

  it("throws when a field every consumer depends on is absent", () => {
    for (const field of ["run", "ts", "kind", "detail"]) {
      const partial = JSON.parse(good(0)) as Record<string, unknown>;
      delete partial[field];
      expect(() => parseEventLog(JSON.stringify(partial))).toThrow(
        new RegExp(`\`${field}\``),
      );
    }
  });

  it("throws when `seq` is absent or is not a number", () => {
    // Checked as a NUMBER, not merely present: `"3"` sorts before `"20"` as a
    // string, which silently reorders any run with ten or more events.
    const partial = JSON.parse(good(0)) as Record<string, unknown>;
    delete partial["seq"];
    expect(() => parseEventLog(JSON.stringify(partial))).toThrow(/`seq`/);
    expect(() => parseEventLog(JSON.stringify({ ...partial, seq: "0" }))).toThrow(/`seq`/);
  });

  it("throws on a `kind` outside the closed set consumers branch on", () => {
    // Closed, unlike a signal's free-text `type`. The retro CLUSTERS signal types
    // as text; an event's consumers DISPATCH on kind, and an unrecognised kind is
    // one a reader cannot render, resume from, or compare across agents. Adding a
    // kind is a deliberate schema change, which is the point.
    expect(() => parseEventLog(good(0, "agent-thought"))).toThrow(/agent-thought/);
  });

  it("carries the 1-based line number on the error, for a caller that points at it", () => {
    try {
      parseEventLog(`${good(0)}\nnot json\n`);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EventLogParseError);
      expect((e as EventLogParseError).line).toBe(2);
    }
  });
});
