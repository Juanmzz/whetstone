import { describe, expect, it } from "vitest";
import { parseTriageRules } from "../triage/rules.js";
import { matchesPathGlob } from "../triage/glob.js";
import { detectStack, type RepoFacts } from "./detect.js";
import { NO_RISK, type InterviewAnswers } from "./interview.js";
import {
  buildTriageRules,
  renderTriageRulesMd,
  renderTriageYaml,
} from "./triage.js";

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
    files: ["package.json", "tsconfig.json", "src/index.ts", "docs/adr.md"],
    packageJson: {},
  }),
);

const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service.",
  risk: NO_RISK,
  strictPaths: [],
  conventions: [],
  ...over,
});

describe("buildTriageRules", () => {
  it("puts the declared strict paths first — first-match-wins means order is precedence", () => {
    const rules = buildTriageRules(tsRepo, {
      ...answers(),
      strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
    });
    expect(rules[0]).toMatchObject({ glob: "src/billing/**", tier: "strict" });
    // The broad `src/**` light rule must come AFTER, or it demotes the strict one.
    const strictIdx = rules.findIndex((r) => r.glob === "src/billing/**");
    const lightIdx = rules.findIndex((r) => r.glob === "src/**");
    expect(strictIdx).toBeLessThan(lightIdx);
  });

  it("always produces at least one rule — an empty document classifies nothing", () => {
    // Greenfield, no strict paths, nothing detected: still a usable ruleset.
    expect(buildTriageRules(detectStack(facts()), answers()).length).toBeGreaterThan(0);
  });

  it("never emits a duplicate glob, even when a strict path collides with a default", () => {
    const rules = buildTriageRules(tsRepo, {
      ...answers(),
      strictPaths: [{ glob: "src/**", reason: "the whole domain is dangerous" }],
    });
    const globs = rules.map((r) => r.glob);
    expect(new Set(globs).size).toBe(globs.length);
    // The strict declaration wins; the default light rule for src/** is dropped.
    expect(rules.find((r) => r.glob === "src/**")?.tier).toBe("strict");
  });

  it("gives every rule a non-blank reason", () => {
    for (const rule of buildTriageRules(tsRepo, answers())) {
      expect(rule.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("normalises reasons to a single line, so the YAML round-trip is exact", () => {
    const rules = buildTriageRules(tsRepo, {
      ...answers(),
      strictPaths: [{ glob: "src/pay/**", reason: "  moves\n  real   money  " }],
    });
    expect(rules[0]?.reason).toBe("moves real money");
  });
});

describe("renderTriageYaml — must round-trip through the real loader", () => {
  const cases: readonly (readonly [string, InterviewAnswers, ReturnType<typeof detectStack>])[] = [
    ["greenfield, no strict paths", answers(), detectStack(facts())],
    ["typical TS repo", answers(), tsRepo],
    [
      "money project with several strict paths",
      answers({
        risk: { ...NO_RISK, money: true },
        strictPaths: [
          { glob: "src/billing/**", reason: "moves money: a bug here is a refund and an apology" },
          { glob: "src/auth/**", reason: "authorisation — a hole is a breach" },
          { glob: "migrations/*.sql", reason: "destructive and irreversible in production" },
        ],
      }),
      tsRepo,
    ],
    [
      "a reason containing YAML metacharacters",
      answers({
        strictPaths: [{ glob: "src/a/**", reason: 'colon: hash # dash - quote " brace {} @ %' }],
      }),
      tsRepo,
    ],
  ];

  for (const [name, ans, stack] of cases) {
    it(`round-trips: ${name}`, () => {
      const rules = buildTriageRules(stack, ans);
      const yaml = renderTriageYaml(rules);
      expect(parseTriageRules(yaml, ".sdd/triage.yaml")).toEqual(rules);
    });
  }

  it("declares the format version the loader demands", () => {
    expect(renderTriageYaml(buildTriageRules(tsRepo, answers()))).toContain("version: 1");
  });

  it("produces globs that actually match the files they were written for", () => {
    const rules = buildTriageRules(tsRepo, {
      ...answers(),
      strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
    });
    const parsed = parseTriageRules(renderTriageYaml(rules));
    const first = parsed.find((r) => matchesPathGlob("src/billing/invoice.ts", r.glob));
    expect(first?.tier).toBe("strict");
  });
});

describe("renderTriageRulesMd", () => {
  it("is the human table the YAML is compiled from, and says so", () => {
    const md = renderTriageRulesMd(buildTriageRules(tsRepo, answers()), { date: "2026-08-08" });
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("id: triage-rules");
    expect(md).toContain("2026-08-08");
    expect(md).toContain("`strict`");
    expect(md).toContain("`light`");
    expect(md).toContain("`off`");
  });

  it("lists every declared strict glob in the strict row", () => {
    const rules = buildTriageRules(tsRepo, {
      ...answers(),
      strictPaths: [
        { glob: "src/billing/**", reason: "moves money" },
        { glob: "src/auth/**", reason: "a hole is a breach" },
      ],
    });
    const md = renderTriageRulesMd(rules, { date: "2026-08-08" });
    expect(md).toContain("src/billing/**");
    expect(md).toContain("src/auth/**");
  });

  it("says plainly that nothing is strict yet when nothing is", () => {
    const md = renderTriageRulesMd(buildTriageRules(tsRepo, answers()), { date: "2026-08-08" });
    expect(md).toMatch(/nothing is strict yet/i);
  });
});

