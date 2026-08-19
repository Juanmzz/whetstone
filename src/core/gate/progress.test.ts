import { describe, expect, it } from "vitest";
import { progressLines } from "./progress.js";

const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);

describe("progressLines — what a waiting reader is told", () => {
  it("names the check when it starts, so silence is not the only signal", () => {
    expect(progressLines({ phase: "started", checkId: "test" }, {})).toEqual([
      "  running  test",
    ]);
  });

  it("reports the result and how long it took", () => {
    const [line] = progressLines({ phase: "finished", checkId: "test", status: "pass", ms: 6712 }, {});

    expect(line).toContain("pass");
    expect(line).toContain("test");
    expect(line).toContain("(6.7s)");
  });

  it("uses milliseconds below a second, where a rounded 0.0s reads as broken", () => {
    const [line] = progressLines({ phase: "finished", checkId: "lint", status: "pass", ms: 84 }, {});

    expect(line).toContain("(84ms)");
  });

  it("carries no control codes when the output is not a terminal", () => {
    // The pre-push hook captures this and CI stores it. An escape sequence in a
    // log is noise a reader cannot strip and a parser trips over.
    const lines = [
      ...progressLines({ phase: "started", checkId: "test" }, {}),
      ...progressLines({ phase: "finished", checkId: "test", status: "pass", ms: 10 }, {}),
    ];

    for (const line of lines) {
      expect(line).not.toContain(ESC);
      expect(line).not.toContain(CR);
    }
  });

  it("stays plain on a terminal too, because checks run concurrently", () => {
    // A first version returned to the start of the line and overwrote it. Running
    // it showed three checks reporting `running` before any finished: there is no
    // single line to rewrite, and the trick mangled the ones beside it.
    const [line] = progressLines({ phase: "finished", checkId: "test", status: "pass", ms: 10 }, {});

    expect(line?.startsWith(CR)).toBe(false);
    expect(line).toContain("pass");
  });

  it("says nothing at all when asked to be quiet, which is what --json needs", () => {
    expect(progressLines({ phase: "started", checkId: "test" }, { quiet: true })).toEqual([]);
  });

  it("says a slow check is still alive, with how long it has been", () => {
    // The gap this closes: `running test` printed once, then 45 seconds of
    // nothing. Silence is indistinguishable from a hang, and a Ctrl-C taken for
    // a hang leaves half-written receipts.
    expect(progressLines({ phase: "still-running", checkId: "test", ms: 12_000 }, {})).toEqual([
      "  ...      test           (12.0s)",
    ]);
  });

  it("stays quiet under --json, like every other progress line", () => {
    expect(
      progressLines({ phase: "still-running", checkId: "test", ms: 12_000 }, { quiet: true }),
    ).toEqual([]);
  });
});
