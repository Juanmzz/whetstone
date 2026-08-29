import { describe, expect, it } from "vitest";
import { afterRunning } from "./outcome.js";

describe("afterRunning — what a person is told when a command finishes", () => {
  it("says it went well in a word, not in an exit code", () => {
    // `exited 0` is the vocabulary of whoever wrote the tool. A process code is
    // for a script; this line is for the person who just pressed enter.
    expect(afterRunning("status", 0)).toContain("done");
    expect(afterRunning("status", 0)).not.toContain("exited");
  });

  it("says the gate BLOCKED rather than naming its number", () => {
    expect(afterRunning("gate", 1)).toMatch(/blocked/i);
  });

  it("says a gate that could not run is broken, never that the change is bad", () => {
    // Hard rule 3, in the one line a menu user reads.
    const said = afterRunning("gate", 2);

    expect(said).toMatch(/could not run/i);
    expect(said).not.toMatch(/failed|blocked/i);
  });

  it("says a plain failure for any other command and any other code", () => {
    expect(afterRunning("update", 1)).toMatch(/did not finish/i);
    expect(afterRunning("retro", 7)).toMatch(/did not finish/i);
  });

  it("carries the code for the reader who wants it, after the words and never instead", () => {
    const [said] = afterRunning("gate", 2).split(" · ");

    expect(said).toMatch(/\(exit 2\)$/);
    expect(afterRunning("status", 0)).not.toMatch(/exit/);
  });

  it("says both ways out, because `q` used to mean two things", () => {
    // The footer said `any key for the menu`, and `q` means quit everywhere else.
    const said = afterRunning("status", 0);

    expect(said).toMatch(/q quits/);
    expect(said).toMatch(/menu/);
  });
});
