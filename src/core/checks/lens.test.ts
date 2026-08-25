import { describe, expect, it } from "vitest";
import { parseLensUnderTest } from "./lens.js";
import { parseCheckFile } from "./registry.js";

const BLOCKING_LENS = `---
id: correctness
description: Does this change do what it says.
kind: llm
severity: block
tiers: [strict]
include: ["src/**/*.ts"]
exclude: []
review_lens: |
  Judge the diff against its stated contract.
calibration:
  fixtures: test/fixtures/lens-correctness
origin: [adr-0008]
version: 3
---
Prose for whoever has to fix a failure.
`;

describe("parseLensUnderTest — the door calibration goes through", () => {
  it("reads a BLOCKING lens that has no receipt, which is the deadlock", () => {
    // A lens at `block` could not be re-measured: calibrate loaded through the
    // registry, the registry refuses a blocking lens without a live receipt,
    // and the refusal recommends re-measuring. Invalidate a receipt by editing
    // the prompt and the only way out was editing severity by hand.
    const lens = parseLensUnderTest("correctness.md", BLOCKING_LENS);

    expect(lens.lens).toContain("stated contract");
    expect(lens.fixtures).toBe("test/fixtures/lens-correctness");
  });

  it("still refuses the same file through the gate's door", () => {
    // The safety property is unchanged. This is the assertion that proves the
    // fix opened a second door rather than widening the first.
    expect(() => parseCheckFile("correctness.md", BLOCKING_LENS)).toThrow(/has not.*earned it/s);
  });

  it("carries no severity at all, so it cannot be mistaken for a loadable check", () => {
    // Structural, not a convention: the value has no field for the authority
    // this door skips, so it cannot be handed to a registry.
    expect(parseLensUnderTest("correctness.md", BLOCKING_LENS)).not.toHaveProperty("severity");
  });

  it("names the judge the check declares, and leaves it absent when it does not", () => {
    expect(parseLensUnderTest("correctness.md", BLOCKING_LENS).agent).toBeUndefined();
    const withAgent = BLOCKING_LENS.replace("kind: llm", "kind: llm\nagent: gemini");
    expect(parseLensUnderTest("correctness.md", withAgent).agent).toBe("gemini");
  });

  it("refuses a check that is not an llm, because there is no lens to measure", () => {
    const deterministic = BLOCKING_LENS.replace("kind: llm", "kind: deterministic")
      .replace(/review_lens: \|\n.*\n/, "command: npm test\n")
      .replace("severity: block", "severity: block");
    expect(() => parseLensUnderTest("correctness.md", deterministic)).toThrow(/not an llm/);
  });

  it("refuses an llm check that declares no fixtures to measure against", () => {
    const noFixtures = BLOCKING_LENS.replace(
      "calibration:\n  fixtures: test/fixtures/lens-correctness\n",
      "",
    );
    expect(() => parseLensUnderTest("correctness.md", noFixtures)).toThrow(/fixtures/);
  });

  it("reports a malformed file the same way the gate does", () => {
    expect(() => parseLensUnderTest("correctness.md", "no frontmatter here")).toThrow(
      /frontmatter/,
    );
  });

  it("still enforces that the id matches the filename", () => {
    expect(() => parseLensUnderTest("other.md", BLOCKING_LENS)).toThrow(/does not match/);
  });
});
