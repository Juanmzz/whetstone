import { describe, expect, it } from "vitest";
import type { TriageRule } from "../contracts.js";
import type { ChangedFile, ChangeStatus } from "../diff/parse.js";
import {
  classify,
  EMPTY_DIFF_TIER,
  FALLBACK_REASON,
  FALLBACK_TIER,
  maxTier,
} from "./classify.js";

const file = (path: string, status: ChangeStatus = "modified"): ChangedFile => ({ path, status });
const renamed = (from: string, to: string): ChangedFile => ({
  path: to,
  status: "renamed",
  oldPath: from,
});
const copied = (from: string, to: string): ChangedFile => ({
  path: to,
  status: "copied",
  oldPath: from,
});

const RULES: readonly TriageRule[] = [
  { glob: "src/core/**", tier: "strict", reason: "the deterministic engine" },
  { glob: "src/shell/**", tier: "light", reason: "thin adapters" },
  { glob: "docs/**", tier: "off", reason: "prose, no ceremony" },
];

describe("maxTier", () => {
  it("orders strict above light above off", () => {
    expect(maxTier("off", "light")).toBe("light");
    expect(maxTier("light", "strict")).toBe("strict");
    expect(maxTier("off", "strict")).toBe("strict");
  });

  it("is commutative, so argument order cannot change a tier", () => {
    expect(maxTier("light", "off")).toBe(maxTier("off", "light"));
    expect(maxTier("strict", "light")).toBe(maxTier("light", "strict"));
  });
});

describe("classify — per-file matching", () => {
  it("classifies a file by the rule that matches it", () => {
    const result = classify([file("src/core/gate.ts")], RULES);
    expect(result.tier).toBe("strict");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.file.path).toBe("src/core/gate.ts");
    expect(result.matches[0]?.tier).toBe("strict");
    expect(result.matches[0]?.reason).toBe("the deterministic engine");
  });

  it("records one match per file, in the order the files arrived", () => {
    // `matches` is the audit trail: a tier decision has to be re-checkable months
    // later without re-running anything. Dropping or reordering entries breaks that.
    const result = classify(
      [file("docs/a.md"), file("src/core/gate.ts"), file("src/shell/git.ts")],
      RULES,
    );
    expect(result.matches.map((m) => m.file.path)).toEqual([
      "docs/a.md",
      "src/core/gate.ts",
      "src/shell/git.ts",
    ]);
    expect(result.matches.map((m) => m.tier)).toEqual(["off", "strict", "light"]);
  });

  it("does not mutate the rules or the file list", () => {
    const rules = [...RULES];
    const files = [file("src/core/a.ts"), file("docs/a.md")];
    classify(files, rules);
    expect(rules).toEqual([...RULES]);
    expect(files.map((f) => f.path)).toEqual(["src/core/a.ts", "docs/a.md"]);
  });
});

/**
 * THE RULE THIS SECTION EXISTS TO PROTECT.
 *
 * Rule order IS precedence. A broad rule placed above a narrow one silently
 * demotes everything the narrow one was written to catch — and the failure is
 * invisible, because the change still gets *a* tier, just the wrong one. These
 * tests fail if anyone "optimises" classification into most-specific-wins, or
 * sorts the rules for tidiness.
 */
describe("classify — first-match-wins", () => {
  const broadFirst: readonly TriageRule[] = [
    { glob: "src/**", tier: "light", reason: "all source" },
    { glob: "src/core/**", tier: "strict", reason: "the deterministic engine" },
  ];

  it("takes the FIRST matching rule when two rules match, even if a later one is stricter", () => {
    const result = classify([file("src/core/gate.ts")], broadFirst);
    expect(result.tier).toBe("light");
    expect(result.matches[0]?.reason).toBe("all source");
  });

  it("gives the opposite answer when the same two rules are reordered", () => {
    const narrowFirst = [...broadFirst].reverse();
    const result = classify([file("src/core/gate.ts")], narrowFirst);
    expect(result.tier).toBe("strict");
    expect(result.matches[0]?.reason).toBe("the deterministic engine");
  });
});

describe("classify — the tier is the MAXIMUM across touched files", () => {
  it("escalates the whole change when one strict file is present", () => {
    const result = classify(
      [file("docs/a.md"), file("docs/b.md"), file("src/core/gate.ts"), file("docs/c.md")],
      RULES,
    );
    expect(result.tier).toBe("strict");
  });

  it("never de-escalates: piling on off files cannot lower a strict change", () => {
    const strictOnly = classify([file("src/core/gate.ts")], RULES);
    const padded = classify(
      [file("src/core/gate.ts"), ...Array.from({ length: 20 }, (_, i) => file(`docs/${i}.md`))],
      RULES,
    );
    expect(padded.tier).toBe(strictOnly.tier);
  });

  it("is off only when EVERY file is off", () => {
    expect(classify([file("docs/a.md"), file("docs/b.md")], RULES).tier).toBe("off");
    expect(classify([file("docs/a.md"), file("src/shell/git.ts")], RULES).tier).toBe("light");
  });
});

describe("classify — unmatched files", () => {
  it("falls back to light, per .wst/triage-rules.md", () => {
    const result = classify([file("some/unknown/path.txt")], RULES);
    expect(result.tier).toBe(FALLBACK_TIER);
    expect(FALLBACK_TIER).toBe("light");
    expect(result.matches[0]?.reason).toBe(FALLBACK_REASON);
  });

  it("lets the fallback ESCALATE a change whose other files are all off", () => {
    // The fallback is light, not off, precisely so an unrecognised path cannot
    // slip through with no ceremony. Combined with the max rule, one unknown file
    // lifts an otherwise trivial diff to light.
    const result = classify([file("docs/a.md"), file("mystery.bin")], RULES);
    expect(result.tier).toBe("light");
  });

  it("falls back for every file when the rule set is empty", () => {
    const result = classify([file("src/core/gate.ts")], []);
    expect(result.tier).toBe("light");
    expect(result.matches[0]?.reason).toBe(FALLBACK_REASON);
  });
});

describe("classify — an empty diff", () => {
  it("is off, with no matches and a reason that says why", () => {
    // The maximum over an empty set is the bottom of the lattice. Throwing would
    // crash `wst gate` on a branch that is legitimately up to date; returning
    // light would invent ceremony for zero files. `matches: []` keeps "nothing
    // changed" distinguishable from "everything was off" for any later consumer.
    const result = classify([], RULES);
    expect(result.tier).toBe(EMPTY_DIFF_TIER);
    expect(EMPTY_DIFF_TIER).toBe("off");
    expect(result.matches).toEqual([]);
    expect(result.reason).toMatch(/no files changed/i);
  });
});

describe("classify — change status", () => {
  it("classifies a DELETED file by its path, exactly like a modification", () => {
    // Deleting src/core/gate.ts is at least as consequential as editing it.
    // Skipping deletions would let a change remove the engine at `off` tier.
    const result = classify([file("src/core/gate.ts", "deleted")], RULES);
    expect(result.tier).toBe("strict");
  });

  it("classifies an ADDED file by its path", () => {
    expect(classify([file("src/core/new.ts", "added")], RULES).tier).toBe("strict");
  });

  it("classifies a rename by its NEW path", () => {
    const result = classify([renamed("docs/a.md", "src/core/a.ts")], RULES);
    expect(result.tier).toBe("strict");
    expect(result.matches[0]?.file.path).toBe("src/core/a.ts");
  });

  /**
   * The hole this closes: `git mv src/core/gate.ts attic/gate.ts` reports only the
   * DESTINATION path. Classifying on the destination alone rates "delete the
   * engine and put it somewhere unclassified" as `light` — the single largest
   * blast-radius change the tool can see, waved through with no ceremony.
   *
   * Taking the max of {new path, old path} for a RENAME can only escalate, which
   * is exactly the direction the rules already commit to.
   */
  it("escalates a rename OUT of a strict path using the pre-rename path", () => {
    const result = classify([renamed("src/core/gate.ts", "attic/gate.ts")], RULES);
    expect(result.tier).toBe("strict");
    expect(result.matches[0]?.file.path).toBe("attic/gate.ts");
    expect(result.matches[0]?.reason).toContain("src/core/gate.ts");
  });

  it("does NOT escalate a rename whose destination is already stricter", () => {
    const result = classify([renamed("docs/a.md", "src/core/a.ts")], RULES);
    expect(result.matches[0]?.reason).toBe("the deterministic engine");
  });

  it("does NOT escalate a COPY from a strict path — the source is untouched", () => {
    // A copy leaves the original exactly as it was. Escalating on it would rate
    // `cp src/core/gate.ts scratch/gate.ts` as a change to the engine, which it
    // is not — and false strict is how a gate loses its credibility.
    const result = classify([copied("src/core/gate.ts", "scratch/gate.ts")], RULES);
    expect(result.tier).toBe("light");
  });
});

describe("classify — the summary reason", () => {
  it("names the tier, the driving file and the rule that earned it", () => {
    const result = classify([file("docs/a.md"), file("src/core/gate.ts")], RULES);
    expect(result.reason).toContain("strict");
    expect(result.reason).toContain("src/core/gate.ts");
    expect(result.reason).toContain("the deterministic engine");
  });

  it("is a single line, so the gate can print it verbatim", () => {
    const result = classify([file("src/core/gate.ts"), file("docs/a.md")], RULES);
    expect(result.reason).not.toContain("\n");
  });

  it("reports how many files sit at the winning tier", () => {
    const result = classify(
      [file("src/core/a.ts"), file("src/core/b.ts"), file("docs/c.md")],
      RULES,
    );
    expect(result.reason).toContain("2 of 3");
  });
});
