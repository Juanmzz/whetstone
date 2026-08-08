import { describe, expect, it } from "vitest";
import { detectStack, type RepoFacts } from "./detect.js";
import {
  NO_RISK,
  buildInterview,
  renderRiskProfile,
  riskIsElevated,
  validateAnswers,
  type InterviewAnswers,
} from "./interview.js";

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  repoName: "acme",
  files: [],
  packageJson: null,
  commitSubjects: [],
  contributors: null,
  ...over,
});

const tsRepo = detectStack(
  facts({
    files: ["package.json", "tsconfig.json", "src/index.ts", "src/index.test.ts"],
    packageJson: { scripts: { test: "vitest run", typecheck: "tsc --noEmit" } },
    commitSubjects: ["feat: a", "fix: b", "chore: c", "docs: d"],
    contributors: 1,
  }),
);

const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service for widget subscriptions.",
  risk: NO_RISK,
  strictPaths: [],
  conventions: [],
  ...over,
});

describe("buildInterview — ask only what the repo could not answer", () => {
  it("asks purpose, risk and strict paths, and nothing else, for a repo it fully read", () => {
    const ids = buildInterview(tsRepo).map((q) => q.id);
    expect(ids).toEqual(["purpose", "risk", "strict-paths"]);
  });

  it("stays under the over-asking ceiling — at most five questions, ever", () => {
    const blank = detectStack(facts());
    expect(buildInterview(blank).length).toBeLessThanOrEqual(5);
  });

  it("asks about conventions ONLY when git history did not reveal a commit style", () => {
    const noHistory = detectStack(facts({ files: ["package.json"], packageJson: {} }));
    expect(buildInterview(noHistory).map((q) => q.id)).toContain("conventions");
    expect(buildInterview(tsRepo).map((q) => q.id)).not.toContain("conventions");
  });

  it("never asks for the memory backend — `files` is the default and the recommendation", () => {
    expect(buildInterview(tsRepo).map((q) => q.id)).not.toContain("backend");
  });

  it("offers the detected source dirs as the strict-paths default", () => {
    const q = buildInterview(tsRepo).find((x) => x.id === "strict-paths");
    expect(q?.defaultAnswer).toBe("src/**");
  });

  it("offers no strict-paths default for a greenfield repo — there is nothing to point at", () => {
    const q = buildInterview(detectStack(facts())).find((x) => x.id === "strict-paths");
    expect(q?.defaultAnswer).toBeNull();
  });

  it("gives every question a reason it could not be inferred", () => {
    for (const q of buildInterview(tsRepo)) {
      expect(q.why.length).toBeGreaterThan(0);
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it("makes the risk question concrete — money, personal data, production data", () => {
    const q = buildInterview(tsRepo).find((x) => x.id === "risk");
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
