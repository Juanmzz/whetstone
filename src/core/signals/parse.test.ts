import { describe, expect, it } from "vitest";
import { parseSignalLog, SignalLogParseError } from "./parse.js";

const good = (id: string): string =>
  JSON.stringify({
    id,
    ts: "2026-08-09T12:00:00-03:00",
    type: "gate-blocked",
    phase: "verify",
    severity: "medium",
    detail: "`test` blocked a change",
  });

describe("parseSignalLog", () => {
  it("reads every well-formed line of a log", () => {
    const parsed = parseSignalLog(`${good("sig-0001")}\n${good("sig-0002")}\n`);
    expect(parsed.map((s) => s.id)).toEqual(["sig-0001", "sig-0002"]);
  });

  it("keeps a log that ends without a trailing newline", () => {
    // `appendSignals` writes one, but a hand-edit is under no obligation to.
    expect(parseSignalLog(good("sig-0001"))).toHaveLength(1);
  });

  it("skips blank lines rather than calling them corrupt", () => {
    expect(parseSignalLog(`\n${good("sig-0001")}\n\n  \n${good("sig-0002")}\n`)).toHaveLength(2);
  });

  it("keeps the optional fields the two readers actually key on", () => {
    const line = JSON.stringify({
      ...(JSON.parse(good("sig-0031")) as object),
      source: "gate",
      fingerprint: "gate-blocked:test:1",
      resolved_by: "retro-0003",
      rule_affected: ["skills/voice.md"],
    });
    const [s] = parseSignalLog(line);
    expect(s?.fingerprint).toBe("gate-blocked:test:1");
    expect(s?.resolved_by).toBe("retro-0003");
    expect(s?.rule_affected).toEqual(["skills/voice.md"]);
  });

  it("throws rather than returning a subset when a line is not valid JSON", () => {
    // The whole point. Returning the readable lines lets the gate believe the log
    // holds nothing at that fingerprint and re-emit a signal it already recorded,
    // which inflates exactly the recurrence the retro reasons over.
    expect(() => parseSignalLog(`${good("sig-0001")}\n{"id": "sig-0002"\n`)).toThrow(/line 2/);
  });

  it("reports the line number of the corrupt line, not of the last one read", () => {
    const text = `${good("sig-0001")}\n${good("sig-0002")}\nnot json\n${good("sig-0004")}\n`;
    expect(() => parseSignalLog(text)).toThrow(/line 3/);
  });

  it("throws on a line that is valid JSON but not an object", () => {
    // A number answers `undefined` to every question a consumer asks it, which is
    // indistinguishable downstream from a signal nobody ever wrote.
    for (const scalar of ["42", '"sig-0001"', "null", "[]"]) {
      expect(() => parseSignalLog(`${good("sig-0001")}\n${scalar}\n`)).toThrow(
        SignalLogParseError,
      );
    }
  });

  it("throws when a field the readers depend on is absent", () => {
    const partial = JSON.parse(good("sig-0002")) as Record<string, unknown>;
    delete partial["id"];
    expect(() => parseSignalLog(JSON.stringify(partial))).toThrow(/`id`/);
  });

  it("throws when severity is a string outside the scale the retro branches on", () => {
    // `cluster` treats a lone `high` as actionable on its own. An unrecognised
    // severity would quietly demote such a signal to "needs to recur first".
    const odd = JSON.stringify({ ...(JSON.parse(good("sig-0002")) as object), severity: "urgent" });
    expect(() => parseSignalLog(odd)).toThrow(/urgent/);
  });

  it("carries the 1-based line number on the error, for a caller that wants to point at it", () => {
    try {
      parseSignalLog(`${good("sig-0001")}\nnot json\n`);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SignalLogParseError);
      expect((e as SignalLogParseError).line).toBe(2);
    }
  });
});
