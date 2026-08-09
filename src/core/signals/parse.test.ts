import { describe, expect, it } from "vitest";
import { parseSignalLog } from "./parse.js";

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

  it("throws rather than returning a subset when a line is not valid JSON", () => {
    // The whole point. Returning the readable lines lets the gate believe the log
    // holds nothing at that fingerprint and re-emit a signal it already recorded,
    // which inflates exactly the recurrence the retro reasons over.
    expect(() => parseSignalLog(`${good("sig-0001")}\n{"id": "sig-0002"\n`)).toThrow(/line 2/);
  });
});
