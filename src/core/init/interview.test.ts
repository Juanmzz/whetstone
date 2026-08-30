import { describe, expect, it } from "vitest";
import type { DeclaredAnswers } from "./detect.js";
import {
  AnswersSchema,
  NO_RISK,
  buildInterview,
  renderRiskProfile,
  riskIsElevated,
  validateAnswers,
  type InterviewAnswers,
} from "./interview.js";

/**
 * Nothing here builds a `StackFacts`, and that is the assertion. The interview
 * used to take one and shrink when a table got lucky. It asks the same five
 * questions of every repo now (ADR-0016).
 */

const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service for widget subscriptions.",
  risk: NO_RISK,
  sourcePaths: [],
  strictPaths: [],
  stack: null,
  ...over,
});

describe("buildInterview — everything not declared on disk is asked", () => {
  it("asks the five questions the repo cannot answer about itself", () => {
    const ids = buildInterview().map((q) => q.id);
    expect(ids).toEqual(["purpose", "risk", "source-paths", "strict-paths", "stack"]);
  });

  /**
   * Seven at its widest: `source-paths` and `stack` arrived when adr-0016 stopped
   * guessing them, and `conventions` and `opinions` left under adr-0030. The
   * ceiling stays a ceiling, and it is lower than the count.
   */
  it("stays under the over-asking ceiling — at most six questions, ever", () => {
    expect(buildInterview().length).toBeLessThanOrEqual(6);
  });

  it("asks nothing a repo can only answer by guessing about itself on day one", () => {
    // `conventions` went out with adr-0030. The honest answer at init is "not yet
    // established", which is what the constitution already writes when nobody says.
    expect(buildInterview().map((q) => q.id)).not.toContain("conventions");
    expect(buildInterview().map((q) => q.id)).not.toContain("opinions");
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

describe("AnswersSchema — a base written by an older Whetstone still parses", () => {
  /**
   * `wst update` reads the base a repo recorded at init and compares it to what
   * this version writes. A strict schema that rejects a key it no longer asks
   * about turns every repo bootstrapped before adr-0030 into one that can never
   * run `update` again, which is the one command that would have told them.
   */
  it("drops the questions it stopped asking instead of refusing the file", () => {
    const older = {
      purpose: "A billing service.",
      sourcePaths: ["src/**"],
      conventions: ["code and docs in English"],
      opinions: ["comment-density"],
    };

    const parsed = AnswersSchema.parse(older);

    expect(parsed.purpose).toBe("A billing service.");
    expect(parsed).not.toHaveProperty("conventions");
    expect(parsed).not.toHaveProperty("opinions");
  });

  it("still refuses a key nobody ever wrote, so a typo is not silently ignored", () => {
    expect(() => AnswersSchema.parse({ purpose: "x", purpsoe: "typo" })).toThrow();
  });
});

/**
 * adr-0016 stopped `init` INFERRING. It never stopped it reading, and a repo
 * that declares its workspaces or its runtime is not a table guessing a language
 * off file extensions. The blank stays a blank where nothing was declared.
 */
describe("buildInterview — a declared fact arrives pre-filled, an inferred one never", () => {
  const declared = (over: Partial<DeclaredAnswers> = {}): DeclaredAnswers => ({
    sourceGlobs: [],
    stack: null,
    strictCandidates: [],
    purpose: null,
    ...over,
  });

  const question = (id: string, d: DeclaredAnswers) =>
    buildInterview(d).find((q) => q.id === id);

  it("still asks the same five questions, whatever the repo declared", () => {
    // An interview that shrinks when a reading gets lucky is one whose coverage
    // nobody can state. Pre-filling is not skipping.
    const ids = buildInterview(declared({ sourceGlobs: ["apps/*/src/**"], stack: "TypeScript" }))
      .map((q) => q.id);

    expect(ids).toEqual(["purpose", "risk", "source-paths", "strict-paths", "stack"]);
  });

  it("pre-fills the source paths a repo's workspaces declare", () => {
    const q = question("source-paths", declared({ sourceGlobs: ["apps/*/src/**"] }));
    expect(q?.defaultAnswer).toBe("apps/*/src/**");
  });

  it("pre-fills the stack from what the repo names, not from what it counts", () => {
    expect(question("stack", declared({ stack: "TypeScript, Node >=22" }))?.defaultAnswer).toBe(
      "TypeScript, Node >=22",
    );
  });

  it("leaves both blank when the repo declared nothing", () => {
    expect(question("source-paths", declared())?.defaultAnswer).toBeNull();
    expect(question("stack", declared())?.defaultAnswer).toBeNull();
  });

  it("never pre-fills what no file can state", () => {
    // Purpose, risk and strict paths are judgements about what you are willing
    // to lose. A repo cannot declare them, so a reading may not answer them.
    const all = declared({ sourceGlobs: ["src/**"], stack: "TypeScript" });
    for (const id of ["purpose", "risk", "strict-paths"]) {
      expect(question(id, all)?.defaultAnswer).toBeNull();
    }
  });

  it("takes no argument and pre-fills nothing, for a caller that read no repo", () => {
    for (const q of buildInterview()) expect(q.defaultAnswer).toBeNull();
  });
});

/**
 * A model's guess and a file's statement arrive in the same field, so the field
 * has to say which. `purpose`, `risk` and `strict-paths` can only ever be
 * drafted, and those are the three where the human gate matters most.
 */
describe("buildInterview — a reading and a guess are labelled apart", () => {
  const declared = { sourceGlobs: ["apps/*/**"], stack: "TypeScript", strictCandidates: [], purpose: null };
  const at = (id: string, drafted = {}) =>
    buildInterview(declared, drafted).find((q) => q.id === id);

  it("calls a workspace glob a reading", () => {
    expect(at("source-paths")?.defaultFrom).toBe("repo");
    expect(at("stack")?.defaultFrom).toBe("repo");
  });

  it("calls the judge's purpose a draft, never a reading", () => {
    expect(at("purpose", { purpose: "a task app" })?.defaultFrom).toBe("draft");
  });

  it("calls a drafted path a draft even where the repo also declared one", () => {
    expect(at("source-paths", { sourcePaths: ["lib/**"] })?.defaultFrom).toBe("draft");
  });

  it("labels nothing where nothing was pre-filled", () => {
    for (const id of ["purpose", "risk", "strict-paths"]) {
      expect(at(id)?.defaultFrom).toBeNull();
    }
  });

  it("never labels a value it does not have", () => {
    for (const q of buildInterview(declared, { purpose: "x", risk: ["money"] })) {
      if (q.defaultAnswer === null) expect(q.defaultFrom).toBeNull();
      else expect(q.defaultFrom).not.toBeNull();
    }
  });
});
