import { describe, expect, it } from "vitest";
import { RETIRED_JUDGES, VALIDATED_JUDGE_VERSION, retirementOf, validatedVersionFor } from "./deprecations.js";
import { AGENTS, parseConfig } from "./schema.js";

describe("retirementOf", () => {
  it("says nothing about a judge that still ships", () => {
    expect(retirementOf("claude")).toBeNull();
    expect(retirementOf("antigravity")).toBeNull();
  });

  it("recognises gemini, whose adapter was deleted", () => {
    expect(retirementOf("gemini")).not.toBeNull();
  });

  it("names no judge the schema still offers", () => {
    // An entry for a selectable agent would fire on a working config.
    for (const id of Object.keys(RETIRED_JUDGES)) expect(AGENTS).not.toContain(id);
  });
});

describe("parseConfig on a retired judge", () => {
  it("explains what happened instead of listing valid enum members", () => {
    // A repo bootstrapped before the deletion still says `agent: gemini`. A raw
    // zod error tells it the value is wrong and not why, nor what to use.
    expect(() => parseConfig({ agent: "gemini" })).toThrow(/2026-06-18/);
  });

  it("names the replacement, so the fix is in the error", () => {
    expect(() => parseConfig({ agent: "gemini" })).toThrow(/antigravity/);
  });

  it("still refuses a value nobody ever offered, without inventing a story", () => {
    expect(() => parseConfig({ agent: "llama" })).toThrow();
    expect(() => parseConfig({ agent: "llama" })).not.toThrow(/2026-06-18/);
  });

  it("leaves a working config alone", () => {
    expect(parseConfig({ agent: "antigravity" }).agent).toBe("antigravity");
  });
});

describe("validatedVersionFor", () => {
  it("names the build the claude adapter was measured against", () => {
    expect(validatedVersionFor("claude")).toBe(VALIDATED_JUDGE_VERSION);
  });

  it("returns nothing for a judge nobody measured", () => {
    // The constant described claude and was compared against whatever judge was
    // configured, so a repo on another vendor was told its version differed.
    expect(validatedVersionFor("antigravity")).toBeNull();
  });
});
