import { describe, expect, it } from "vitest";
import { AGENTS } from "./schema.js";
import {
  RETIRED_JUDGES,
  VALIDATED_JUDGE_VERSION,
  judgeWarning,
  validatedVersionFor,
} from "./deprecations.js";

describe("judgeWarning", () => {
  it("says nothing about a judge that still serves", () => {
    expect(judgeWarning("claude")).toBeNull();
  });

  it("warns that gemini stopped serving individual accounts, with the date", () => {
    // Google moved Gemini CLI to Antigravity CLI. On 2026-06-18 it stopped
    // serving AI Pro, Ultra and free Code Assist; only Standard and Enterprise
    // licences carry on. Offering it as a judge without saying so hands most
    // people a reviewer that cannot run.
    const warning = judgeWarning("gemini");

    expect(warning).toContain("2026-06-18");
    expect(warning).toMatch(/antigravity/i);
  });

  it("names the tiers that still work, so a licensed repo is not scared off it", () => {
    expect(judgeWarning("gemini")).toMatch(/standard|enterprise/i);
  });

  it("covers every retired judge with an entry", () => {
    for (const id of Object.keys(RETIRED_JUDGES)) {
      expect(judgeWarning(id as (typeof AGENTS)[number])).not.toBeNull();
    }
  });

  it("only retires judges the schema actually offers", () => {
    // An entry for an agent nobody can select is a warning nobody can trigger.
    for (const id of Object.keys(RETIRED_JUDGES)) expect(AGENTS).toContain(id);
  });
});

describe("validatedVersionFor", () => {
  it("names the build the claude adapter was measured against", () => {
    expect(validatedVersionFor("claude")).toBe(VALIDATED_JUDGE_VERSION);
  });

  it("returns nothing for a judge nobody measured", () => {
    // The constant described `claude` and was compared against whatever judge
    // was configured, so a gemini repo was told 0.56.0 differs from 2.1.224.
    // Two vendors, one version line: the comparison was never meaningful.
    expect(validatedVersionFor("gemini")).toBeNull();
  });
});
