import { describe, expect, it } from "vitest";
import {
  CalibrationReceiptSchema,
  blockAuthority,
  fixturesHash,
  lensHash,
  recordCalibration,
  type CalibrationReceipt,
  type FixtureFile,
} from "./receipt.js";

const LENS = "You are a correctness review lens. Decide whether this diff INTRODUCES a bug.";

const fixtures: FixtureFile[] = [
  { path: "race-bad.diff", expected: "fail", hash: "1111111111111111111111111111111111111111" },
  { path: "race-good.diff", expected: "pass", hash: "2222222222222222222222222222222222222222" },
];

const perfect = () =>
  recordCalibration({
    checkId: "correctness",
    lens: LENS,
    fixtures,
    model: "sonnet",
    runtime: { name: "claude", version: "2.1.226" },
    results: [
      { fixture: "race-bad.diff", expected: "fail", got: ["fail", "fail", "fail"] },
      { fixture: "race-good.diff", expected: "pass", got: ["pass", "pass", "pass"] },
    ],
    at: new Date("2026-08-09T12:00:00Z"),
  });

/**
 * THE RULE THIS MODULE EXISTS FOR.
 *
 * `AGENTS.md` non-negotiable 2 says a judgment check earns its `block`, *enforced by
 * the schema*. Before this module the schema asked only whether the YAML said
 * `status: passed` with `runs >= 1` — two hand-typed fields. Editing three lines in a
 * text editor promoted an unmeasured lens to blocking authority, and it was
 * demonstrated doing exactly that.
 *
 * A receipt replaces the claim with fingerprints of what was actually measured.
 */
describe("the verdict is derived, never declared", () => {
  it("passes when every run matched its fixture's expectation", () => {
    expect(perfect().verdict).toBe("passed");
  });

  it("fails on a single flip, however many runs agreed", () => {
    const r = recordCalibration({
      ...inputOf(perfect()),
      results: [
        { fixture: "race-bad.diff", expected: "fail", got: ["fail", "fail", "fail"] },
        { fixture: "race-good.diff", expected: "pass", got: ["pass", "fail", "pass"] },
      ],
    });
    expect(r.verdict).toBe("failed");
  });

  it("fails when a run could not produce a verdict at all", () => {
    // `errored` is the judge being broken, not the lens being wrong — but it is also
    // not evidence of stability, and this receipt exists to evidence stability.
    const r = recordCalibration({
      ...inputOf(perfect()),
      results: [
        { fixture: "race-bad.diff", expected: "fail", got: ["fail", "errored", "fail"] },
        { fixture: "race-good.diff", expected: "pass", got: ["pass", "pass", "pass"] },
      ],
    });
    expect(r.verdict).toBe("failed");
  });

  it("refuses to mint a receipt covering fewer results than fixtures", () => {
    expect(() =>
      recordCalibration({
        ...inputOf(perfect()),
        results: [{ fixture: "race-bad.diff", expected: "fail", got: ["fail"] }],
      }),
    ).toThrow(/fixture/i);
  });

  it("refuses zero runs — a receipt is evidence, and nothing happened", () => {
    expect(() =>
      recordCalibration({
        ...inputOf(perfect()),
        results: [
          { fixture: "race-bad.diff", expected: "fail", got: [] },
          { fixture: "race-good.diff", expected: "pass", got: [] },
        ],
      }),
    ).toThrow(/run/i);
  });

  it("has no writable verdict field a caller could set", () => {
    // The schema must reject a hand-written object whose verdict disagrees with its
    // own results — otherwise the file on disk is back to being a claim.
    const forged = { ...perfect(), verdict: "passed", results: [
      { fixture: "race-bad.diff", expected: "fail", got: ["pass"] },
    ] };
    expect(CalibrationReceiptSchema.safeParse(forged).success).toBe(false);
  });
});

describe("blockAuthority", () => {
  const current = fixturesHash(fixtures);

  it("grants block when the receipt describes exactly this lens and these fixtures", () => {
    expect(blockAuthority(LENS, perfect(), current).ok).toBe(true);
  });

  it("DENIES block when there is no receipt at all", () => {
    const decision = blockAuthority(LENS, null, current);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/no calibration/i);
  });

  /**
   * The behaviour the old `detail` field asked a human to remember, in prose:
   * "Changing the lens INVALIDATES the previous measurement — v3's result does not
   * describe this text." A hash does not need to be remembered.
   */
  it("DENIES block when one character of the lens changed", () => {
    const decision = blockAuthority(`${LENS} `, perfect(), current);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/lens/i);
  });

  it("DENIES block when the fixture set changed", () => {
    const moved = fixturesHash([...fixtures, { path: "new.diff", expected: "pass", hash: "3333" }]);
    const decision = blockAuthority(LENS, perfect(), moved);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/fixture/i);
  });

  it("DENIES block when the measurement itself failed", () => {
    const failed = recordCalibration({
      ...inputOf(perfect()),
      results: [
        { fixture: "race-bad.diff", expected: "fail", got: ["fail", "pass", "fail"] },
        { fixture: "race-good.diff", expected: "pass", got: ["pass", "pass", "pass"] },
      ],
    });
    expect(blockAuthority(LENS, failed, current).ok).toBe(false);
  });

  it("cannot be satisfied by a receipt for a different check", () => {
    // Copying another lens's passing receipt next to this one must not work.
    const other = recordCalibration({ ...inputOf(perfect()), checkId: "security", lens: "different" });
    expect(blockAuthority(LENS, other, current).ok).toBe(false);
  });
});

describe("the hashes", () => {
  it("changes the lens hash on any change to the prompt", () => {
    expect(lensHash(LENS)).not.toBe(lensHash(`${LENS}.`));
  });

  it("does not depend on the order fixtures arrive in", () => {
    expect(fixturesHash(fixtures)).toBe(fixturesHash([...fixtures].reverse()));
  });

  it("changes when a fixture's CONTENT changes, not just its name", () => {
    const edited: FixtureFile[] = [{ ...fixtures[0]!, hash: "ffff" }, fixtures[1]!];
    expect(fixturesHash(edited)).not.toBe(fixturesHash(fixtures));
  });

  it("changes when a fixture's EXPECTATION is flipped", () => {
    // Same files, opposite ground truth, is a different measurement entirely.
    const flipped: FixtureFile[] = [{ ...fixtures[0]!, expected: "pass" }, fixtures[1]!];
    expect(fixturesHash(flipped)).not.toBe(fixturesHash(fixtures));
  });
});

/** The input a receipt was minted from, for building variants in tests. */
function inputOf(r: CalibrationReceipt) {
  return {
    checkId: r.checkId,
    lens: LENS,
    fixtures,
    model: r.model,
    runtime: r.runtime,
    results: r.results,
    at: new Date(r.measuredAt),
  };
}
