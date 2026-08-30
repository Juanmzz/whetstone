import { describe, expect, it } from "vitest";
import { mentionsGate, sourcedPaths } from "./prepush.js";

describe("mentionsGate", () => {
  it("finds the gate however the hook spells the binary", () => {
    for (const line of [
      'wst gate --no-lens --range "$base..HEAD"',
      "npx wst gate",
      "node dist/cli.js gate --range main..HEAD",
      "whetstone gate",
    ]) {
      expect(mentionsGate(line)).toBe(true);
    }
  });

  it("does not count a commented-out call", () => {
    // The same false positive in the other direction.
    expect(mentionsGate("# wst gate --no-lens")).toBe(false);
    expect(mentionsGate("   #wst gate")).toBe(false);
  });

  it("does not count another command that happens to say gate", () => {
    expect(mentionsGate("echo 'the gate is open'")).toBe(false);
    expect(mentionsGate("wst status")).toBe(false);
  });
});

describe("sourcedPaths", () => {
  const self = ".husky/_/pre-push";

  it("follows the dot form husky's shim uses", () => {
    expect(sourcedPaths('. "$(dirname "$0")/h"', self)).toEqual([".husky/_/h"]);
  });

  it("follows `source` and a bare relative path", () => {
    expect(sourcedPaths("source ./lib/common.sh", self)).toEqual([".husky/_/lib/common.sh"]);
  });

  it("resolves ${0%/*} the same way, since husky writes both", () => {
    expect(sourcedPaths('. "${0%/*}/h"', self)).toEqual([".husky/_/h"]);
  });

  it("skips a path it cannot resolve rather than guessing", () => {
    expect(sourcedPaths('. "$HOOKS_DIR/common"', self)).toEqual([]);
  });

  it("ignores a dot that is not a source line", () => {
    expect(sourcedPaths("echo . ", self)).toEqual([]);
    expect(sourcedPaths("../thing", self)).toEqual([]);
  });

  it("does not escape the repository", () => {
    expect(sourcedPaths('. "../../../etc/passwd"', self)).toEqual([]);
    // Two levels up from `.husky/_/` is still the repository root.
    expect(sourcedPaths('. "../../etc/passwd"', self)).toEqual(["etc/passwd"]);
  });

  it("returns every source in the file, in order", () => {
    const text = ['. "$(dirname "$0")/a"', 'echo hi', 'source "${0%/*}/b"'].join("\n");
    expect(sourcedPaths(text, self)).toEqual([".husky/_/a", ".husky/_/b"]);
  });
});
