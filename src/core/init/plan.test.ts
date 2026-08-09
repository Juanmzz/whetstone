import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildRegistry, parseCheckFile } from "../checks/registry.js";
import { parseTriageRules } from "../triage/rules.js";
import { classify } from "../triage/classify.js";
import type { ClockPort } from "../ports.js";
import type { RepoFacts } from "./detect.js";
import { NO_RISK, type InterviewAnswers } from "./interview.js";
import { auditSelfContained } from "./selfcontained.js";
import { planInit, type InitPlan } from "./plan.js";

const clock: ClockPort = { now: () => new Date("2026-08-08T12:00:00Z") };

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  repoName: "acme",
  files: [],
  packageJson: null,
  commitSubjects: [],
  contributors: null,
  ...over,
});

const TS_REPO = facts({
  files: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/index.ts", "src/index.test.ts"],
  packageJson: { scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } },
  commitSubjects: ["feat: a", "fix: b", "chore: c"],
  contributors: 3,
});

const answers = (over: Partial<InterviewAnswers> = {}): InterviewAnswers => ({
  purpose: "A billing service for widget subscriptions.",
  risk: NO_RISK,
  strictPaths: [],
  conventions: [],
  ...over,
});

const MONEY = answers({
  risk: { ...NO_RISK, money: true, note: null },
  strictPaths: [{ glob: "src/billing/**", reason: "moves money: a bug here is a refund" }],
});

const plan = (over: Partial<Parameters<typeof planInit>[0]> = {}): InitPlan =>
  planInit({ facts: TS_REPO, answers: answers(), clock, ...over });

const at = (p: InitPlan, path: string): string | undefined =>
  p.files.find((f) => f.path === path)?.contents;

describe("planInit — what a typical TypeScript repo gets", () => {
  const p = plan({ answers: MONEY });

  it("writes the whole .sdd/ substrate plus the two vendor files, and nothing else", () => {
    // No `.claude/` (ADR-0010). This list IS the contract with a target repo: every
    // path here is one somebody else has to live with, and the two that are not
    // `.sdd/` are the ones that collide.
    expect(p.files.map((f) => f.path).sort()).toEqual(
      [
        ".sdd/checks/lint.md",
        ".sdd/checks/test.md",
        ".sdd/checks/typecheck.md",
        ".sdd/constitution.md",
        ".sdd/memory/README.md",
        ".sdd/memory/decisions/_TEMPLATE.md",
        ".sdd/memory/patterns.md",
        ".sdd/memory/retro-log.md",
        ".sdd/memory/signals.jsonl",
        ".sdd/triage-rules.md",
        ".sdd/triage.yaml",
        ".sdd/wst.yaml",
        "AGENTS.md",
        "CLAUDE.md",
      ].sort(),
    );
  });

  it("copies the eight skills rather than generating them", () => {
    expect(p.copies).toHaveLength(8);
    expect(p.copies.map((c) => c.to)).toContain(".sdd/skills/tdd-discipline.md");
  });

  it("starts signals.jsonl empty — the first line must be a real event", () => {
    expect(at(p, ".sdd/memory/signals.jsonl")).toBe("");
  });

  it("emits no duplicate paths", () => {
    const paths = p.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

});

describe("planInit — everything generated must load through the real loaders", () => {
  for (const [name, input] of [
    ["a money project with strict paths", { answers: MONEY }],
    ["a low-risk project with none", {}],
    ["a greenfield repo", { facts: facts() }],
    ["with an agent lens requested", { answers: MONEY, options: { seedAgentLens: true } }],
  ] as const) {
    const p = plan(input as Partial<Parameters<typeof planInit>[0]>);

    it(`triage.yaml parses and matches the plan's rules: ${name}`, () => {
      const yaml = at(p, ".sdd/triage.yaml") ?? "";
      expect(parseTriageRules(yaml, ".sdd/triage.yaml")).toEqual(p.rules);
    });

    it(`every check file loads into a registry: ${name}`, () => {
      const checks = p.files
        .filter((f) => f.path.startsWith(".sdd/checks/"))
        .map((f) => parseCheckFile(f.path.replace(".sdd/checks/", ""), f.contents));
      expect(() => buildRegistry(checks)).not.toThrow();
      for (const check of checks) {
        if (check.kind === "agent-lens") expect(check.severity).not.toBe("block");
      }
    });

    it(`wst.yaml is valid YAML naming only skills that get installed: ${name}`, () => {
      const parsed = parseYaml(at(p, ".sdd/wst.yaml") ?? "") as Record<string, unknown>;
      const installed = new Set(p.copies.map((c) => c.to));
      for (const skill of parsed["skills"] as string[]) {
        expect(installed.has(`.sdd/${skill}`)).toBe(true);
      }
    });

    it(`the payload is self-contained: ${name}`, () => {
      expect(auditSelfContained({ files: p.files, copies: p.copies })).toEqual([]);
    });
  }

  it("the generated rules actually classify the paths they were written for", () => {
    const p = plan({ answers: MONEY });
    const rules = parseTriageRules(at(p, ".sdd/triage.yaml") ?? "");
    const result = classify(
      [
        { path: "src/billing/invoice.ts", status: "modified" },
        { path: "docs/notes.md", status: "modified" },
      ],
      rules,
      ".sdd/triage.yaml",
    );
    // One strict file makes the whole change strict.
    expect(result.tier).toBe("strict");
  });
});


describe("planInit — refuses to produce a broken payload", () => {
  it("throws when the answers do not validate", () => {
    expect(() => plan({ answers: answers({ purpose: "" }) })).toThrow(/purpose/i);
  });

  it("throws when an elevated risk profile names no strict path", () => {
    expect(() => plan({ answers: answers({ risk: { ...NO_RISK, money: true } }) })).toThrow(
      /strict/i,
    );
  });

  it("throws when the human's own words smuggle in a dangling reference", () => {
    // Free text flows into the constitution verbatim. An agent running the
    // interview will happily paste "as described in docs/woz/SPEC.md" — and that
    // path does not exist in the repo being bootstrapped.
    expect(() =>
      plan({ answers: answers({ purpose: "A billing service, as specced in docs/woz/SPEC.md." }) }),
    ).toThrow(/self-contained/i);
  });
});

describe("planInit — a repo with nothing to detect", () => {
  const p = plan({ facts: facts(), answers: answers({ purpose: "Not started yet." }) });

  it("seeds no checks rather than commands that would error on every run", () => {
    expect(p.files.filter((f) => f.path.startsWith(".sdd/checks/"))).toEqual([]);
  });

  it("still produces a working triage document", () => {
    expect(parseTriageRules(at(p, ".sdd/triage.yaml") ?? "").length).toBeGreaterThan(0);
  });

  it("still produces a constitution, the memory substrate and the vendor files", () => {
    for (const path of [".sdd/constitution.md", ".sdd/memory/README.md", "AGENTS.md", "CLAUDE.md"]) {
      expect(at(p, path)).toBeDefined();
    }
  });

  it("tells the human what it could NOT do, rather than pretending it is done", () => {
    expect(p.notes.join("\n")).toMatch(/no check/i);
  });
});

describe("planInit — notes", () => {
  it("reports what was inferred, so the human can correct a wrong guess", () => {
    expect(plan({ answers: MONEY }).notes.join("\n")).toMatch(/typescript/i);
  });

});
