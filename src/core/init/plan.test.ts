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

  /**
   * ADR-0012 part 3: `memory/out-of-scope/` is the fourth memory artifact.
   *
   * `memory/` already records what went wrong (`signals.jsonl`), what was decided
   * (`decisions.md`) and what a retro concluded (`retro-log.md`). Nothing
   * recorded what was deliberately REFUSED, and a refusal without a file gets
   * re-proposed every six months with the argument re-derived from scratch.
   */
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
        if (check.kind === "llm") expect(check.severity).not.toBe("block");
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
    expect(() => plan({ answers: answers({ sourcePaths: ["   "] }) })).toThrow(/blank/i);
  });

  it("throws when an elevated risk profile names no strict path", () => {
    expect(() => plan({ answers: answers({ risk: { ...NO_RISK, money: true } }) })).toThrow(
      /strict/i,
    );
  });

  it("throws when the human's own words smuggle in a dangling reference", () => {
    // A strict path's REASON is free text and it lands in `triage.yaml` verbatim.
    // An agent running the interview will happily paste "as described in
    // docs/PARALLEL.md", and that path does not exist in the repo being
    // bootstrapped. It is the only route human prose still takes into a generated
    // file, now that the constitution is not one of them.
    expect(() =>
      plan({
        answers: answers({
          strictPaths: [{ glob: "src/pay/**", reason: "moves money, as specced in docs/PARALLELSPEC.md" }],
        }),
      }),
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

  it("refuses to plan at all when nobody said where the code lives", () => {
    // It used to plan and seed no checks, which writes a definition layer that
    // verifies nothing. Nothing downstream can recover from that: `ready` can only
    // ever answer INCOMPLETE, and the reason is three commands away.
    expect(() => plan({ answers: answers({ sourcePaths: [] }) })).toThrow(/source path/i);
  });
});

describe("planInit — a repo with nothing to detect", () => {
  const p = plan({
    facts: facts(),
    answers: answers({ purpose: "Not started yet.", sourcePaths: ["src/**"], stack: null }),
  });

  it("seeds no checks rather than commands that would error on every run", () => {
    // The paths are declared; what is missing is a script to run over them.
    expect(p.files.filter((f) => f.path.startsWith(".wst/checks/"))).toEqual([]);
  });

  it("still produces a working triage document", () => {
    expect(parseTriageRules(at(p, ".wst/triage.yaml") ?? "").length).toBeGreaterThan(0);
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

describe("what a new installation is, after the readiness cut", () => {
  const at = (p: ReturnType<typeof plan>): string[] => p.files.map((f) => f.path).sort();

  it("writes only what is needed to select and run readiness checks", () => {
    // The product is verification. Everything `init` used to add beyond that was
    // apparatus a new repo had not asked for and could not yet have a use for.
    expect(at(plan({ answers: MONEY }))).toEqual([
      ".wst/.gitignore",
      ".wst/checks/lint.md",
      ".wst/checks/test.md",
      ".wst/checks/typecheck.md",
      ".wst/triage.yaml",
      ".wst/wst.yaml",
    ]);
  });

  it("copies no skills, because nothing in the readiness path reads one", () => {
    expect(plan({ answers: MONEY }).copies).toEqual([]);
  });

  it("writes no memory, no signal log and no decision record", () => {
    const paths = at(plan({ answers: MONEY })).join("\n");
    for (const gone of ["memory", "signals.jsonl", "retro-log", "decisions.md", "patterns"]) {
      expect(paths).not.toContain(gone);
    }
  });

  it("writes no vendor file and no front door", () => {
    const paths = at(plan({ answers: MONEY })).join("\n");
    for (const gone of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) expect(paths).not.toContain(gone);
  });

  it("writes no hook, because arming one is not installing verification", () => {
    expect(at(plan({ answers: MONEY })).join("\n")).not.toContain(".githooks");
  });

  it("writes no constitution and no triage prose, since `triage.yaml` is the source", () => {
    const paths = at(plan({ answers: MONEY })).join("\n");
    expect(paths).not.toContain("constitution");
    expect(paths).not.toContain("triage-rules");
  });

  it("seeds no check the repo did not declare a command for", () => {
    // adr-0030's two brought rules are apparatus in a repo installing verification
    // for the first time. What it gets is its own scripts, checked.
    const paths = at(plan({ answers: MONEY })).join("\n");
    expect(paths).not.toContain("comment-density");
    expect(paths).not.toContain("commit-message");
  });
});
