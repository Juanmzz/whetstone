import { describe, expect, it } from "vitest";
import { defectOf, renderSlices, slicesOf, type SliceOutcome } from "./slice.js";

const fixture = (file: string, expected: "pass" | "fail", clean: boolean): SliceOutcome => ({
  file,
  expected,
  clean,
});

describe("defectOf", () => {
  it("pairs a -good and a -bad fixture into one slice", () => {
    expect(defectOf("race-good.diff")).toBe("race");
    expect(defectOf("race-bad.diff")).toBe("race");
  });

  it("keeps a multi-word defect whole", () => {
    expect(defectOf("off-by-one-bad.diff")).toBe("off-by-one");
  });

  it("gives a fixture off the convention a slice of its own", () => {
    // Better than folding it somewhere arbitrary: a slice of one is visible, and
    // silently attaching it to another defect's numbers is not.
    expect(defectOf("regression-2026-08-18.diff")).toBe("regression-2026-08-18");
  });
});

describe("slicesOf", () => {
  const v4: SliceOutcome[] = [
    fixture("boundary-bad.diff", "fail", true),
    fixture("boundary-good.diff", "pass", true),
    fixture("known-bad.diff", "fail", true),
    fixture("known-good.diff", "pass", true),
    fixture("nullish-bad.diff", "fail", true),
    fixture("nullish-good.diff", "pass", true),
    fixture("race-bad.diff", "fail", true),
    fixture("race-good.diff", "pass", false),
    fixture("swallow-bad.diff", "fail", true),
    fixture("swallow-good.diff", "pass", true),
  ];

  it("puts the worst slice first, where a reader looks", () => {
    expect(slicesOf(v4).map((s) => s.defect)).toEqual([
      "race",
      "boundary",
      "known",
      "nullish",
      "swallow",
    ]);
  });

  it("separates a false positive from a missed defect", () => {
    // The whole point. `race 1/2` does not say which way it failed, and the two
    // have opposite fixes: loosen the lens, or tighten it.
    const race = slicesOf(v4).find((s) => s.defect === "race");

    expect(race).toEqual({ defect: "race", clean: 1, total: 2, cleanGood: 0, totalGood: 1 });
  });

  it("counts a missed planted defect without touching the -good tally", () => {
    const slices = slicesOf([
      fixture("race-bad.diff", "fail", false),
      fixture("race-good.diff", "pass", true),
    ]);

    expect(slices[0]).toEqual({ defect: "race", clean: 1, total: 2, cleanGood: 1, totalGood: 1 });
  });
});

describe("renderSlices", () => {
  it("names the direction of a miss, since the number alone does not", () => {
    const lines = renderSlices(
      slicesOf([
        fixture("race-bad.diff", "fail", true),
        fixture("race-good.diff", "pass", false),
      ]),
    );

    expect(lines[0]).toContain("race  1/2");
    expect(lines[0]).toContain("called correct code broken (1 of 1 `-good`)");
  });

  it("says missed defect when the failure is under-sensitivity, not over", () => {
    const lines = renderSlices(
      slicesOf([
        fixture("race-bad.diff", "fail", false),
        fixture("race-good.diff", "pass", true),
      ]),
    );

    expect(lines[0]).toContain("missed a planted defect");
  });

  it("leaves a clean slice unannotated, so the annotated ones carry weight", () => {
    const lines = renderSlices(slicesOf([fixture("known-good.diff", "pass", true)]));

    expect(lines[0]).toBe("  known  1/1");
  });
});
