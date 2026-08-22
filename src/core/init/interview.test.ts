import { OPINIONS } from "../opinions/index.js";
import { describe, expect, it } from "vitest";
import {
  NO_RISK,
  buildInterview,
  renderRiskProfile,
  riskIsElevated,
  validateAnswers,
  type InterviewAnswers,
} from "./interview.js";

/**
 * Nothing here builds a `StackFacts`, and that is the assertion. The interview
 * used to take one and shrink when a table got lucky — a repo with four
 * conventional-looking commits was never asked what its conventions are. It asks
 * the same six questions of every repo now (ADR-0016).
 */

const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service for widget subscriptions.",
  risk: NO_RISK,
  sourcePaths: [],
  strictPaths: [],
  stack: null,
  conventions: [],
  opinions: [],
  ...over,
});

describe("buildInterview — everything not declared on disk is asked", () => {
  it("asks the seven questions the repo cannot answer about itself", () => {
    const ids = buildInterview().map((q) => q.id);
    expect(ids).toEqual([
      "purpose",
      "risk",
      "source-paths",
      "strict-paths",
      "stack",
      "conventions",
      "opinions",
    ]);
  });

  /**
   * The ceiling moved from five to six, and that is the cost the ADR accepted:
   * `source-paths` and `stack` used to be guessed from a directory-name list and
   * a file-extension table. A blank a human fills beats a table's confident wrong
   * answer — but it is still a question that did not exist before, so the ceiling
   * stays a ceiling.
   */
  it("stays under the over-asking ceiling — at most seven questions, ever", () => {
    expect(buildInterview().length).toBeLessThanOrEqual(7);
  });

  it("asks about every opinion in ONE question, so the ceiling holds as they grow", () => {
    // adr-0025 accepted "one question per opinion". One multi-select costs less and
    // keeps the count at seven however many are shipped.
    const opinions = buildInterview().filter((q) => q.id === "opinions");

    expect(opinions).toHaveLength(1);
    expect(opinions[0]?.options.length).toBe(OPINIONS.length);
  });

  it("offers no opinion pre-selected, which is what `never seed one unasked` means", () => {
    expect(buildInterview().find((q) => q.id === "opinions")?.defaultAnswer).toBeNull();
  });

  it("asks about conventions even for a repo whose commits all look conventional", () => {
    // A commit history is a pattern, not a promise. Reading four `feat:` subjects
    // and writing "this project uses Conventional Commits" into a constitution
    // states a rule nobody agreed to.
    expect(buildInterview().map((q) => q.id)).toContain("conventions");
  });

  it("asks where the code lives, and does not pre-fill it from a directory name", () => {
    const q = buildInterview().find((x) => x.id === "source-paths");
    expect(q?.kind).toBe("paths");
    expect(q?.defaultAnswer).toBeNull();
  });

  it("asks what the project is built with — no file states that", () => {
    const q = buildInterview().find((x) => x.id === "stack");
    expect(q?.kind).toBe("text");
  });

  it("never asks for the memory backend — `files` is the default and the recommendation", () => {
    expect(buildInterview().map((q) => q.id)).not.toContain("backend");
  });

  it("offers no strict-paths default — nothing on disk says which code is dangerous", () => {
    const q = buildInterview().find((x) => x.id === "strict-paths");
    expect(q?.defaultAnswer).toBeNull();
  });

  it("gives every question a reason it could not be inferred", () => {
    for (const q of buildInterview()) {
      expect(q.why.length).toBeGreaterThan(0);
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it("makes the risk question concrete — money, personal data, production data", () => {
    const q = buildInterview().find((x) => x.id === "risk");
    const values = q?.options.map((o) => o.value) ?? [];
    expect(values).toEqual(
      expect.arrayContaining(["money", "personalData", "productionData", "authn", "safetyCritical"]),
    );
  });
});

describe("risk profile", () => {
  it("treats an all-false profile as not elevated", () => {
    expect(riskIsElevated(NO_RISK)).toBe(false);
  });

  it("treats any single flag as elevated", () => {
    expect(riskIsElevated({ ...NO_RISK, personalData: true })).toBe(true);
  });

  it("renders the honest low-risk sentence rather than an empty section", () => {
    expect(renderRiskProfile(NO_RISK)).toMatch(/correctness/i);
  });

  it("renders the flags that are set", () => {
    const text = renderRiskProfile({ ...NO_RISK, money: true, personalData: true });
    expect(text).toMatch(/money/i);
    expect(text).toMatch(/personal data/i);
    expect(text).not.toMatch(/safety/i);
  });
});

describe("validateAnswers", () => {
  it("accepts a complete low-risk answer set", () => {
    expect(validateAnswers(answers())).toEqual([]);
  });

  it("rejects a blank purpose — the constitution would ship with a hole in it", () => {
    expect(validateAnswers(answers({ purpose: "   " }))).toContainEqual(
      expect.stringContaining("purpose"),
    );
  });

  it("rejects an elevated risk profile with no strict path", () => {
    const errors = validateAnswers(answers({ risk: { ...NO_RISK, money: true } }));
    expect(errors.join(" ")).toMatch(/strict/i);
  });

  it("accepts an elevated risk profile once a strict path names the exposure", () => {
    expect(
      validateAnswers(
        answers({
          risk: { ...NO_RISK, money: true },
          strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a strict path with no reason — an unreviewable rule cannot be retired", () => {
    const errors = validateAnswers(answers({ strictPaths: [{ glob: "src/a/**", reason: "  " }] }));
    expect(errors.join(" ")).toMatch(/reason/i);
  });

  it("rejects a blank source glob — it would become a check `include` matching nothing", () => {
    expect(validateAnswers(answers({ sourcePaths: ["src/**", "  "] })).join(" ")).toMatch(
      /source/i,
    );
  });

  it("rejects duplicate strict globs — under first-match-wins the second is dead", () => {
    const errors = validateAnswers(
      answers({
        strictPaths: [
          { glob: "src/a/**", reason: "one" },
          { glob: "src/a/**", reason: "two" },
        ],
      }),
    );
    expect(errors.join(" ")).toMatch(/duplicate/i);
  });
});
