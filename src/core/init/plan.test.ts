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
  sourcePaths: ["src/**"],
  strictPaths: [],
  stack: "TypeScript on Node.",
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

  it("writes the whole .wst/ substrate plus the two vendor files, and nothing else", () => {
    // No `.claude/` (ADR-0010). This list IS the contract with a target repo: every
    // path here is one somebody else has to live with, and the two that are not
    // `.wst/` are the ones that collide.
    expect(p.files.map((f) => f.path).sort()).toEqual(
      [
        ".wst/checks/lint.md",
        ".wst/checks/test.md",
        ".wst/checks/typecheck.md",
        ".wst/constitution.md",
        ".wst/memory/README.md",
        ".wst/memory/decisions/_TEMPLATE.md",
        ".wst/memory/out-of-scope/README.md",
        ".wst/memory/patterns.md",
        ".wst/memory/retro-log.md",
        ".wst/memory/signals.jsonl",
        ".wst/triage-rules.md",
        ".wst/triage.yaml",
        ".wst/wst.yaml",
        "AGENTS.md",
        "CLAUDE.md",
      ].sort(),
    );
  });

  it("copies the eight skills rather than generating them", () => {
    expect(p.copies).toHaveLength(8);
    expect(p.copies.map((c) => c.to)).toContain(".wst/skills/tdd-discipline.md");
  });

  it("starts signals.jsonl empty — the first line must be a real event", () => {
    expect(at(p, ".wst/memory/signals.jsonl")).toBe("");
  });

  /**
   * ADR-0012 part 3: `memory/out-of-scope/` is the fourth memory artifact.
   *
   * `memory/` already records what went wrong (`signals.jsonl`), what was decided
   * (`decisions/`) and what was proposed (`proposals/`, `retro-log.md`). Nothing
   * recorded what was deliberately REFUSED, and a refusal without a file gets
   * re-proposed every six months with the argument re-derived from scratch.
   */
  describe("memory/out-of-scope/", () => {
    const readme = at(p, ".wst/memory/out-of-scope/README.md");

    it("ships with a README, because an empty directory does not survive git", () => {
      expect(readme).not.toBeUndefined();
    });

    it("states all four things an entry must record", () => {
      const text = (readme ?? "").toLowerCase();
      for (const field of ["what was asked", "why", "escape hatch", "request"]) {
        expect(text).toContain(field);
      }
    });

    /**
     * Hard rule 7. The form is borrowed from `mattpocock/skills` (MIT), and the
     * attribution has to be IN the emitted file: a pointer to this project's own
     * LICENSE dangles the moment the file lands in a repo that has never heard of
     * it, which is the exact bug class `selfcontained.ts` exists to catch.
     */
    it("carries its attribution inline, not as a reference", () => {
      expect(readme).toContain("mattpocock/skills");
      expect(readme).toContain("MIT");
    });

    it("ships no entries — the directory is a home, not a claim", () => {
      const entries = p.files.filter(
        (f) =>
          f.path.startsWith(".wst/memory/out-of-scope/") &&
          !f.path.endsWith("/README.md"),
      );
      expect(entries).toEqual([]);
    });
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
      const yaml = at(p, ".wst/triage.yaml") ?? "";
      expect(parseTriageRules(yaml, ".wst/triage.yaml")).toEqual(p.rules);
    });

    it(`every check file loads into a registry: ${name}`, () => {
      const checks = p.files
        .filter((f) => f.path.startsWith(".wst/checks/"))
        .map((f) => parseCheckFile(f.path.replace(".wst/checks/", ""), f.contents));
      expect(() => buildRegistry(checks)).not.toThrow();
      for (const check of checks) {
        if (check.kind === "agent-lens") expect(check.severity).not.toBe("block");
      }
    });

    it(`wst.yaml is valid YAML naming only skills that get installed: ${name}`, () => {
      const parsed = parseYaml(at(p, ".wst/wst.yaml") ?? "") as Record<string, unknown>;
      const installed = new Set(p.copies.map((c) => c.to));
      for (const skill of parsed["skills"] as string[]) {
        expect(installed.has(`.wst/${skill}`)).toBe(true);
      }
    });

    it(`the payload is self-contained: ${name}`, () => {
      expect(auditSelfContained({ files: p.files, copies: p.copies })).toEqual([]);
    });
  }

  it("the generated rules actually classify the paths they were written for", () => {
    const p = plan({ answers: MONEY });
    const rules = parseTriageRules(at(p, ".wst/triage.yaml") ?? "");
    const result = classify(
      [
        { path: "src/billing/invoice.ts", status: "modified" },
        { path: "docs/notes.md", status: "modified" },
      ],
      rules,
      ".wst/triage.yaml",
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

/**
 * The declared source layout is the single input two different outputs hang off,
 * and it arrives from the interview rather than from a directory-name list. If
 * they ever disagree, one of them is judging code the other one does not know
 * about.
 */
describe("planInit — the declared source paths reach both places that need them", () => {
  const p = plan({
    answers: answers({ sourcePaths: ["apps/*/src/**", "packages/*/src/**"] }),
  });

  it("puts a light triage rule over each of them", () => {
    const globs = parseTriageRules(at(p, ".wst/triage.yaml") ?? "")
      .filter((r) => r.tier === "light")
      .map((r) => r.glob);
    expect(globs).toContain("apps/*/src/**");
    expect(globs).toContain("packages/*/src/**");
  });

  it("scopes every seeded check's include to them, and to nothing else", () => {
    const checks = p.files
      .filter((f) => f.path.startsWith(".wst/checks/"))
      .map((f) => parseCheckFile(f.path.replace(".wst/checks/", ""), f.contents));
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.include).toEqual(["apps/*/src/**", "packages/*/src/**"]);
    }
  });

  it("seeds no check at all when nobody said where the code lives", () => {
    const blind = plan({ answers: answers({ sourcePaths: [] }) });
    expect(blind.files.filter((f) => f.path.startsWith(".wst/checks/"))).toEqual([]);
    expect(blind.notes.join("\n")).toMatch(/source path/i);
  });
});

describe("planInit — a repo with nothing to detect", () => {
  const p = plan({
    facts: facts(),
    answers: answers({ purpose: "Not started yet.", sourcePaths: [], stack: null }),
  });

  it("seeds no checks rather than commands that would error on every run", () => {
    expect(p.files.filter((f) => f.path.startsWith(".wst/checks/"))).toEqual([]);
  });

  it("still produces a working triage document", () => {
    expect(parseTriageRules(at(p, ".wst/triage.yaml") ?? "").length).toBeGreaterThan(0);
  });

  it("still produces a constitution, the memory substrate and the vendor files", () => {
    for (const path of [".wst/constitution.md", ".wst/memory/README.md", "AGENTS.md", "CLAUDE.md"]) {
      expect(at(p, path)).toBeDefined();
    }
  });

  it("tells the human what it could NOT do, rather than pretending it is done", () => {
    expect(p.notes.join("\n")).toMatch(/no check/i);
  });
});

describe("planInit — notes", () => {
  it("reports what it READ and where from, so a wrong reading can be corrected", () => {
    const notes = plan({ answers: MONEY }).notes.join("\n");
    expect(notes).toMatch(/pnpm-lock\.yaml/);
    expect(notes).toMatch(/package\.json scripts/);
  });
});
