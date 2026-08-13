/**
 * The plan parser. PURE — text in, a declaration out.
 *
 * ADR-0013: `wst plan` READS a plan and never writes one, so this is the whole of
 * the input contract. Every case below is a way a declared path could produce a
 * CONFIDENT WRONG ANSWER, which is the one failure the ADR says would kill the
 * command: "if the predicted tier diverges from the enforced one often enough that
 * nobody reads the prediction, the front door is guessing rather than routing".
 */

import { describe, expect, it } from "vitest";
import { parsePlan, PlanParseError } from "./parse.js";

const PLAN = `---
intent: Build the plan gate as the front door
paths:
  - src/core/plan/parse.ts
  - src/commands/plan.ts
---
The prose the human iterated on. The engine does not read this.
`;

describe("parsePlan", () => {
  it("takes the declared paths and the intent out of the frontmatter", () => {
    const plan = parsePlan(PLAN, "PLAN.md");
    expect(plan.paths).toEqual(["src/core/plan/parse.ts", "src/commands/plan.ts"]);
    expect(plan.intent).toBe("Build the plan gate as the front door");
  });

  it("keeps the body, which is the half a human reads", () => {
    expect(parsePlan(PLAN, "PLAN.md").body).toBe(
      "The prose the human iterated on. The engine does not read this.",
    );
  });

  it("accepts a plan with no intent, because a missing intent still routes", () => {
    // Rule 3, applied to the input: a plan that cannot say what it is FOR can still
    // be told which checks will judge it. Refusing here would be the command
    // failing to run over something it can answer perfectly well.
    const plan = parsePlan(`---\npaths: [src/core/x.ts]\n---\n`, "PLAN.md");
    expect(plan.intent).toBeNull();
  });

  it("rejects a plan with no frontmatter", () => {
    expect(() => parsePlan("# just prose\n", "PLAN.md")).toThrow(PlanParseError);
  });

  it("rejects a plan that declares no paths", () => {
    // The declared paths ARE the input. Without them there is nothing to classify,
    // and answering "off — no files changed" would be a prediction about a plan
    // nobody made.
    expect(() => parsePlan(`---\nintent: do a thing\n---\n`, "PLAN.md")).toThrow(
      /declares no `paths`/,
    );
  });

  it("rejects an empty paths list rather than reporting the empty-diff tier", () => {
    expect(() => parsePlan(`---\npaths: []\n---\n`, "PLAN.md")).toThrow(/is empty/);
  });

  it("rejects `paths` written as one string instead of a list", () => {
    // YAML makes this a one-character mistake, and the failure is silent in the bad
    // direction: iterating a string yields characters, so the plan would classify
    // 22 single-letter paths and report `light`.
    expect(() => parsePlan(`---\npaths: src/core/x.ts\n---\n`, "PLAN.md")).toThrow(/a list/);
  });

  it("names the source file in the error, because a plan arrives from stdin too", () => {
    expect(() => parsePlan("# just prose\n", "-")).toThrow(/^-: /);
  });

  it("rejects an absolute path, which no triage glob can match", () => {
    // This is the case that would produce a confident wrong answer rather than a
    // failure: `matchesGlob` compares repo-relative paths, so `/home/x/src/core/y.ts`
    // matches nothing and lands on the `light` fallback — and that fallback exists
    // to say "unrecognised", not "trivial".
    expect(() => parsePlan(`---\npaths: ["/home/x/src/core/y.ts"]\n---\n`, "PLAN.md")).toThrow(
      /absolute/,
    );
  });

  it("rejects a path that climbs out of the repo", () => {
    expect(() => parsePlan(`---\npaths: ["../other/src/core/y.ts"]\n---\n`, "PLAN.md")).toThrow(
      /climbs out/,
    );
  });

  it("strips a leading ./, which is the same path written two ways", () => {
    expect(parsePlan(`---\npaths: ["./src/core/x.ts"]\n---\n`, "PLAN.md").paths).toEqual([
      "src/core/x.ts",
    ]);
  });

  it("de-duplicates repeated paths instead of inflating the file count", () => {
    // A duplicate changes no tier and no coverage answer; all it does is make the
    // printed reason say "2 of 2 files" about one file.
    const plan = parsePlan(`---\npaths: [src/core/x.ts, src/core/x.ts]\n---\n`, "PLAN.md");
    expect(plan.paths).toEqual(["src/core/x.ts"]);
  });

  it("rejects a non-string entry rather than stringifying it", () => {
    expect(() => parsePlan(`---\npaths: [42]\n---\n`, "PLAN.md")).toThrow(/expected a string/);
  });

  it("rejects an empty path entry", () => {
    expect(() => parsePlan(`---\npaths: ["  "]\n---\n`, "PLAN.md")).toThrow(/is empty/);
  });

  it("rejects an intent that is not prose, rather than printing [object Object]", () => {
    expect(() => parsePlan(`---\npaths: [src/core/x.ts]\nintent: {a: 1}\n---\n`, "PLAN.md")).toThrow(
      /`intent` as object/,
    );
  });

  it("treats a blank intent as unstated", () => {
    expect(parsePlan(`---\npaths: [src/core/x.ts]\nintent: "   "\n---\n`, "PLAN.md").intent).toBeNull();
  });

  it("rejects frontmatter that parses but is not a mapping", () => {
    expect(() => parsePlan(`---\n- a\n- b\n---\n`, "PLAN.md")).toThrow(/not a mapping/);
  });

  it("rejects frontmatter that is not valid YAML", () => {
    expect(() => parsePlan(`---\npaths: [unclosed\n---\n`, "PLAN.md")).toThrow(/not valid YAML/);
  });
});
