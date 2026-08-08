import { describe, expect, it } from "vitest";
import type { Tier } from "../checks/schema.js";
import {
  CRITICALITIES,
  MARK,
  criticalityFor,
  findingTrigger,
  joinCriticality,
  naiveMaxCriticality,
  tierFloor,
  type Criticality,
} from "./criticality.js";

const finding = (severity: "block" | "warn" | "annotate") =>
  ({ checkId: "c", severity, detail: "d", path: "p" }) as const;

describe("tierFloor — the FLOOR, which is why this is not max()", () => {
  /**
   * THE ONE ASSERTION THE WHOLE LAYER RESTS ON. If `strict` ever maps to `review`,
   * every strict-tier file goes red and the annotation stops distinguishing anything.
   */
  it("caps the tier's own contribution at skim — strict alone is NEVER red", () => {
    expect(tierFloor("strict")).toBe("skim");
  });

  it("gives light and off no floor at all", () => {
    expect(tierFloor("light")).toBe("skip");
    expect(tierFloor("off")).toBe("skip");
  });

  it("is total over Tier", () => {
    const tiers: Tier[] = ["strict", "light", "off"];
    for (const tier of tiers) expect(CRITICALITIES).toContain(tierFloor(tier));
  });
});

describe("findingTrigger — severity is what raises red", () => {
  it("makes a block-severity finding red", () => {
    expect(findingTrigger("block")).toBe("review");
  });

  it("keeps warn and annotate findings at skim", () => {
    expect(findingTrigger("warn")).toBe("skim");
    expect(findingTrigger("annotate")).toBe("skim");
  });
});

describe("joinCriticality", () => {
  it("takes the more critical of two", () => {
    expect(joinCriticality("skip", "review")).toBe("review");
    expect(joinCriticality("skim", "skip")).toBe("skim");
    expect(joinCriticality("skip", "skip")).toBe("skip");
  });

  it("is commutative", () => {
    const all: Criticality[] = ["review", "skim", "skip"];
    for (const a of all) {
      for (const b of all) expect(joinCriticality(a, b)).toBe(joinCriticality(b, a));
    }
  });
});

describe("criticalityFor — the composed rule", () => {
  it("🔴 a block-severity finding on the file, whatever its tier", () => {
    expect(criticalityFor("strict", [finding("block")])).toBe("review");
    expect(criticalityFor("light", [finding("block")])).toBe("review");
    expect(criticalityFor("off", [finding("block")])).toBe("review");
  });

  it("🟡 strict tier with NO finding", () => {
    expect(criticalityFor("strict", [])).toBe("skim");
  });

  it("🟡 a warn-level finding, even on a strict file", () => {
    expect(criticalityFor("strict", [finding("warn")])).toBe("skim");
    expect(criticalityFor("light", [finding("warn")])).toBe("skim");
  });

  it("⚪ everything else — a light or off file the checks were happy with", () => {
    expect(criticalityFor("light", [])).toBe("skip");
    expect(criticalityFor("off", [])).toBe("skip");
  });

  it("takes the worst finding when a file has several", () => {
    expect(criticalityFor("off", [finding("warn"), finding("block")])).toBe("review");
    expect(criticalityFor("off", [finding("annotate"), finding("warn")])).toBe("skim");
  });
});

/**
 * The regression this layer exists to prevent, stated as an executable comparison.
 *
 * `naiveMaxCriticality` is the WRONG rule — `max(tier, finding)` with strict mapped
 * straight to red — kept in the source purely so the difference is provable rather
 * than asserted in a comment. A 40-file change where one file has a real finding is
 * the canonical case: the annotation is worth having only if it names ONE file.
 */
describe("the 40-file change — why max() destroys the signal", () => {
  const change = Array.from({ length: 40 }, (_, i) => ({
    path: `src/core/gate/f${i}.ts`,
    tier: "strict" as Tier,
    findings: i === 7 ? [finding("block")] : [],
  }));

  it("marks exactly one file red", () => {
    const reds = change.filter((f) => criticalityFor(f.tier, f.findings) === "review");
    expect(reds.map((f) => f.path)).toEqual(["src/core/gate/f7.ts"]);
  });

  it("marks the other 39 skim, not red", () => {
    const skims = change.filter((f) => criticalityFor(f.tier, f.findings) === "skim");
    expect(skims).toHaveLength(39);
  });

  it("PROOF: max(tier, finding) would have painted all 40 red", () => {
    const reds = change.filter((f) => naiveMaxCriticality(f.tier, f.findings) === "review");
    expect(reds).toHaveLength(40);
    // ...which is the same as saying nothing at all.
    expect(new Set(change.map((f) => naiveMaxCriticality(f.tier, f.findings))).size).toBe(1);
  });
});

describe("MARK", () => {
  it("gives each level a distinct mark", () => {
    expect(MARK.review).toBe("🔴");
    expect(MARK.skim).toBe("🟡");
    expect(MARK.skip).toBe("⚪");
  });
});
