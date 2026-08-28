import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, SPINNER, liveLine, quietLine, runningLine } from "./progress.js";

const CONTROL = new RegExp(String.fromCharCode(13));

describe("liveLine — what a terminal shows while something is still working", () => {
  it("cycles through the frames rather than running off the end", () => {
    const at = (frame: number): string => liveLine("cluster", 1000, frame);
    expect(at(SPINNER.length)).toBe(at(0));
    expect(at(SPINNER.length * 3 + 2)).toBe(at(2));
  });

  it("carries the elapsed time, which is the part that says it is not hung", () => {
    expect(liveLine("cluster", 12_300, 0)).toContain("12.3s");
  });

  it("names what is running, so two of them are told apart", () => {
    expect(liveLine("type:gate-blocked", 0, 0)).toContain("type:gate-blocked");
  });

  it("stays on one line, since the writer overwrites it in place", () => {
    expect(liveLine("cluster", 1000, 0)).not.toContain("\n");
  });
});

describe("quietLine — the same fact where nothing can be overwritten", () => {
  it("carries no carriage return, for a pipe and a CI log", () => {
    expect(quietLine("cluster", 30_000)).not.toMatch(CONTROL);
  });

  it("says the elapsed time too: off a terminal it is the only proof of life", () => {
    expect(quietLine("cluster", 30_000)).toContain("30.0s");
  });

  it("beats slowly enough that a CI log is not a wall of it", () => {
    expect(HEARTBEAT_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("runningLine — one line for however many checks are in flight", () => {
  it("names them all, because the gate runs them concurrently", () => {
    // A per-check spinner was tried and reverted: three checks reporting at once
    // have no single line to rewrite, and each mangled the ones beside it.
    expect(runningLine(["test", "typecheck"], 1000, 0)).toContain("test, typecheck");
  });

  it("carries the elapsed time of the slowest one still going", () => {
    expect(runningLine(["test"], 12_300, 0)).toContain("12.3s");
  });

  it("is empty when nothing is running, so there is no line to leave behind", () => {
    expect(runningLine([], 1000, 0)).toBe("");
  });

  it("stays on one line whatever it is given", () => {
    expect(runningLine(["a", "b", "c", "d", "e", "f"], 1000, 0)).not.toContain("\n");
  });
});
