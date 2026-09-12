import { describe, expect, it } from "vitest";
import { parseTriageRules } from "../triage/rules.js";
import { matchesPathGlob } from "../triage/glob.js";
import { NO_RISK, type InterviewAnswers } from "./interview.js";
import {
  buildTriageRules,
  renderTriageYaml,
} from "./triage.js";

/**
 * The source layout is now DECLARED, not detected: `sourcePaths` is an interview
 * answer, so a `light` rule over the code exists exactly when somebody said where
 * the code is.
 */
const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service.",
  risk: NO_RISK,
  sourcePaths: ["src/**"],
  strictPaths: [],
  stack: null,
  ...over,
});

describe("buildTriageRules", () => {
  it("puts the declared strict paths first — first-match-wins means order is precedence", () => {
    const rules = buildTriageRules({
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
    expect(buildTriageRules(answers({ sourcePaths: [] })).length).toBeGreaterThan(0);
  });

  it("never emits a duplicate glob, even when a strict path collides with a default", () => {
    const rules = buildTriageRules({
      ...answers(),
      strictPaths: [{ glob: "src/**", reason: "the whole domain is dangerous" }],
    });
    const globs = rules.map((r) => r.glob);
    expect(new Set(globs).size).toBe(globs.length);
    // The strict declaration wins; the default light rule for src/** is dropped.
    expect(rules.find((r) => r.glob === "src/**")?.tier).toBe("strict");
  });

  it("puts a light rule over every DECLARED source path, and invents none", () => {
    const rules = buildTriageRules(answers({ sourcePaths: ["apps/*/src/**", "packages/*/src/**"] }));
    const light = rules.filter((r) => r.tier === "light").map((r) => r.glob);
    expect(light).toContain("apps/*/src/**");
    expect(light).toContain("packages/*/src/**");
    // `src/**` was never named, so nothing may claim it. The old detector would
    // have found it from a directory-name list.
    expect(light).not.toContain("src/**");
  });

  it("covers no code at all when nobody said where the code is", () => {
    const globs = buildTriageRules(answers({ sourcePaths: [] })).map((r) => r.glob);
    expect(globs).not.toContain("src/**");
  });

  it("gives every rule a non-blank reason", () => {
    for (const rule of buildTriageRules(answers())) {
      expect(rule.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("normalises reasons to a single line, so the YAML round-trip is exact", () => {
    const rules = buildTriageRules({
      ...answers(),
      strictPaths: [{ glob: "src/pay/**", reason: "  moves\n  real   money  " }],
    });
    expect(rules[0]?.reason).toBe("moves real money");
  });
});

describe("renderTriageYaml — must round-trip through the real loader", () => {
  const cases: readonly (readonly [string, InterviewAnswers])[] = [
    ["greenfield: no source paths, no strict paths", answers({ sourcePaths: [] })],
    ["typical TS repo", answers()],
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
    ],
    [
      "a reason containing YAML metacharacters",
      answers({
        strictPaths: [{ glob: "src/a/**", reason: 'colon: hash # dash - quote " brace {} @ %' }],
      }),
    ],
    [
      "a monorepo that declares several source roots",
      answers({ sourcePaths: ["apps/*/src/**", "packages/*/src/**"] }),
    ],
  ];

  for (const [name, ans] of cases) {
    it(`round-trips: ${name}`, () => {
      const rules = buildTriageRules(ans);
      const yaml = renderTriageYaml(rules);
      expect(parseTriageRules(yaml, ".wst/triage.yaml")).toEqual(rules);
    });
  }

  it("declares the format version the loader demands", () => {
    expect(renderTriageYaml(buildTriageRules(answers()))).toContain("version: 1");
  });

  it("produces globs that actually match the files they were written for", () => {
    const rules = buildTriageRules({
      ...answers(),
      strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
    });
    const parsed = parseTriageRules(renderTriageYaml(rules));
    const first = parsed.find((r) => matchesPathGlob("src/billing/invoice.ts", r.glob));
    expect(first?.tier).toBe("strict");
  });
});
