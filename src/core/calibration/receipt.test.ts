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
      // TEN runs, not three: `MIN_AUTHORISING_RUNS` is part of what grants block, so
      // a fixture short of it would test the floor instead of what it means to test.
      { fixture: "race-bad.diff", expected: "fail", got: Array.from({ length: 10 }, () => "fail" as const) },
      { fixture: "race-good.diff", expected: "pass", got: Array.from({ length: 10 }, () => "pass" as const) },
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

/**
 * A RECEIPT WITH TOO FEW RUNS IS THE HONOUR-SYSTEM HOLE WEARING A HASH.
 *
 * Measured, an hour apart, on the same lens and the same fixtures:
 *   --runs 10  ->  race-good flipped once  ->  failed
 *   --runs 2   ->  10/10 clean             ->  passed
 *
 * Both receipts are genuine. Both carry real hashes of the real prompt and the real
 * fixture set. The second one is worthless, and it was produced by accident while
 * testing the plumbing — it overwrote the honest failing one.
 *
 * So the verdict alone cannot grant authority. `runs` is part of the evidence, and a
 * sample too small to catch a flip has not looked for one.
 */
describe("a passing receipt must have looked hard enough", () => {
  const enough = (runs: number) =>
    recordCalibration({
      ...inputOf(perfect()),
      results: [
        { fixture: "a.diff", expected: "fail", got: Array.from({ length: runs }, () => "fail" as const) },
        { fixture: "b.diff", expected: "pass", got: Array.from({ length: runs }, () => "pass" as const) },
      ],
      fixtures: [
        { path: "a.diff", expected: "fail", hash: "1111" },
        { path: "b.diff", expected: "pass", hash: "2222" },
      ],
    });

  const current = fixturesHash([
    { path: "a.diff", expected: "fail", hash: "1111" },
    { path: "b.diff", expected: "pass", hash: "2222" },
  ]);

  it("DENIES block on a two-run sweep, however clean", () => {
    const decision = blockAuthority(LENS, enough(2), current);
    expect(decision.ok).toBe(false);
    expect(decision.ok === false && decision.reason).toMatch(/runs|sample/i);
  });

  it("grants block once the sample is large enough", () => {
    expect(blockAuthority(LENS, enough(10), current).ok).toBe(true);
  });

  it("still records the small run honestly rather than refusing to mint it", () => {
    // The measurement happened; it just does not authorise. Refusing to write it
    // would hide a real diagnostic run, which is what `--runs 2` is FOR.
    expect(enough(2).verdict).toBe("passed");
    expect(enough(2).runs).toBe(2);
  });
});

describe("what an errored run leaves behind", () => {
  const base = {
    checkId: "correctness",
    lens: "Review this diff.",
    fixtures: [{ path: "a.diff", expected: "pass" as const, hash: "h" }],
    model: "sonnet",
    runtime: { name: "claude", version: "2.1.237" },
    at: new Date("2026-08-24T00:00:00Z"),
  };

  it("records WHICH error, so a later reader can tell if a retry would cover it", () => {
    const receipt = recordCalibration({
      ...base,
      results: [{ fixture: "a.diff", expected: "pass", got: ["pass", "errored"], errors: ["spawn"] }],
    });

    expect(receipt.results[0]?.errors).toEqual(["spawn"]);
    // The loader parses what is on disk, and a strict schema rejects an unknown key.
    expect(CalibrationReceiptSchema.safeParse(JSON.parse(JSON.stringify(receipt))).success).toBe(true);
  });

  it("parses a receipt written before errors were recorded", () => {
    const older = {
      format: 1,
      checkId: "correctness",
      lensHash: "a".repeat(64),
      fixturesHash: "b".repeat(64),
      model: "sonnet",
      runtime: { name: "claude", version: "2.1.234" },
      runs: 2,
      results: [{ fixture: "a.diff", expected: "pass", got: ["pass", "errored"] }],
      verdict: "failed",
      measuredAt: "2026-08-20T13:47:48.154Z",
    };

    expect(CalibrationReceiptSchema.safeParse(older).success).toBe(true);
  });
});
