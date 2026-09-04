import { describe, expect, it } from "vitest";
import { afterRunning } from "./outcome.js";

describe("afterRunning", () => {
  it("gives `ready` the product's own three words", () => {
    expect(afterRunning("ready", 0)).toContain("Ready");
    expect(afterRunning("ready", 1)).toContain("Needs work");
    expect(afterRunning("ready", 2)).toContain("Verification incomplete");
  });

  it("never shows a process code, whatever the command or the number", () => {
    // A number is protocol for a shell. It has never told a reader what to do next,
    // and `exit 2` in particular reads as an error when it means "not established".
    for (const command of ["ready", "status", "init", "triage", "check"]) {
      for (const code of [0, 1, 2, 127]) {
        const said = afterRunning(command, code);
        expect(said).not.toMatch(/exit/i);
        expect(said).not.toMatch(/\bcode\b/i);
        expect(said).not.toMatch(/\b(0|1|2|127)\b/);
      }
    }
  });

  it("tells a reader how to leave, since the report is already on screen", () => {
    expect(afterRunning("status", 0)).toContain("q quits");
  });

  it("does not call a failure `done`", () => {
    expect(afterRunning("triage", 1)).not.toContain("done");
  });
});
