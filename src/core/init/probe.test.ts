import { describe, expect, it } from "vitest";
import { severityFor, probeNote, type ProbeResult } from "./probe.js";

const green: ProbeResult = { ran: true, ok: true, exitCode: 0, durationMs: 12_400 };
const red: ProbeResult = { ran: true, ok: false, exitCode: 1, durationMs: 3_100 };
const absent: ProbeResult = { ran: false, why: "no such command" };

describe("severityFor", () => {
  it("blocks on a command that was watched running green", () => {
    // The whole point of the item: in a repo initialised today the only thing
    // that blocks is `typecheck`, and it blocks on an assertion rather than a
    // measurement. A red suite stops nobody.
    expect(severityFor(green)).toBe("block");
  });

  it("warns on a command that ran and failed", () => {
    // A suite that needs a database is not a repo doing something wrong, and a
    // check that blocks from the first minute gets the gate switched off.
    expect(severityFor(red)).toBe("warn");
  });

  it("warns on a command that could not run at all", () => {
    expect(severityFor(absent)).toBe("warn");
  });

  it("warns when nothing was measured, because nothing was measured", () => {
    // `--dry-run` and a caller that skipped the probe both land here. Absence of
    // evidence may never read as evidence.
    expect(severityFor(undefined)).toBe("warn");
  });
});

describe("probeNote — the line the check body carries as its evidence", () => {
  it("records the date, the exit code and how long it took", () => {
    expect(probeNote(green, "2026-08-30")).toMatch(/2026-08-30/);
    expect(probeNote(green, "2026-08-30")).toMatch(/exit 0/);
    expect(probeNote(green, "2026-08-30")).toMatch(/12\.4s/);
  });

  it("says what the exit code was when it failed, not just that it did", () => {
    const note = probeNote(red, "2026-08-30");
    expect(note).toMatch(/exit 1/);
    expect(note).toMatch(/warn/);
  });

  it("says why it could not run, in the words the shell reported", () => {
    expect(probeNote(absent, "2026-08-30")).toContain("no such command");
  });

  it("says plainly that nothing ran when nothing did", () => {
    expect(probeNote(undefined, "2026-08-30")).toMatch(/not measured/i);
  });

  it("rounds a sub-second run rather than printing 0.0s", () => {
    expect(probeNote({ ran: true, ok: true, exitCode: 0, durationMs: 240 }, "2026-08-30")).toMatch(/0\.2s/);
  });
});
