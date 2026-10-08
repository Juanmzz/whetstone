/**
 * `failureLines` over what real tools print.
 *
 * Captured through `child_process.exec`, the way a check runs: vitest 4.1 and tsc 7
 * over a three-file project, and node 24 crashing inside a dependency. Only the
 * machine's own paths were replaced. Here and not beside the function because a
 * file under `src/core/` may not read the filesystem, tests included.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failureLines } from "../src/core/gate/detail.js";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures/failure-output", name), "utf-8");

const ESC = String.fromCharCode(27);

describe("failureLines, over what real tools print", () => {
  it("keeps the name of every failing vitest test", () => {
    const lines = failureLines(`${fixture("vitest.stdout.txt")}\n${fixture("vitest.stderr.txt")}`);

    expect(lines).toContain(" FAIL  src/price.test.ts > total > multiplies cents by quantity");
    expect(lines).toContain(
      " FAIL  src/price.test.ts > parseLine > accepts a line with a quantity of zero as an empty line",
    );
    expect(lines).toContain("AssertionError: expected 501 to be 500 // Object.is equality");
  });

  it("drops blank lines, which is most of what a runner prints", () => {
    const lines = failureLines(fixture("vitest.stderr.txt"));

    expect(lines.every((line) => line.trim() !== "")).toBe(true);
  });

  it("strips tsc's colours and keeps the error with its position", () => {
    const raw = fixture("tsc.stdout.txt");
    expect(raw).toContain(ESC);

    const lines = failureLines(raw);

    expect(lines.join("\n")).not.toContain(ESC);
    expect(lines).toContain(
      "src/cart.ts:4:9 - error TS2322: Type 'number' is not assignable to type 'string'.",
    );
    expect(lines.at(-1)).toBe("Found 2 errors in the same file, starting at: src/cart.ts:4");
  });

  it("drops the stack frames inside node_modules and keeps the error they led to", () => {
    const raw = fixture("node.stderr.txt");
    expect(raw).toMatch(/^\s+at .*node_modules/m);

    const lines = failureLines(raw);

    expect(lines.some((line) => /^\s*at .*node_modules/.test(line))).toBe(false);
    expect(lines).toContain("YAMLParseError: Sequence item without - indicator at line 3, column 1:");
  });
});
