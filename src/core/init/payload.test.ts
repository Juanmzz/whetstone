import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { detectStack, type RepoFacts } from "./detect.js";
import { NO_RISK } from "./interview.js";
import { buildTriageRules, renderTriageRulesMd } from "./triage.js";
import {
  ADR_TEMPLATE,
  CLAUDE_MD,
  MEMORY_README,
  SKILL_FILES,
  activeSkills,
  renderAgentsMd,
  renderConstitution,
  renderWstYaml,
  skillCopies,
} from "./payload.js";

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
    files: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/index.ts", "src/index.test.ts"],
    packageJson: { scripts: { test: "vitest run", typecheck: "tsc --noEmit" } },
    commitSubjects: ["feat: a", "fix: b", "chore: c"],
    contributors: 4,
  }),
);

const solo = detectStack(
  facts({ files: ["package.json", "src/a.ts"], packageJson: {}, contributors: 1 }),
);

describe("skills", () => {
  it("copies all eight skills verbatim, whatever is active", () => {
    expect(SKILL_FILES).toHaveLength(8);
    const copies = skillCopies();
    expect(copies).toHaveLength(8);
    for (const copy of copies) {
      expect(copy.to).toMatch(/^\.sdd\/skills\/[a-z-]+\.md$/);
      expect(copy.from).toBe(copy.to.replace(".sdd/", ""));
    }
  });

  it("activates all eight for a team repo", () => {
    expect(activeSkills(tsRepo)).toHaveLength(8);
  });

  it("leaves doc-locations inactive for solo work — there is no team/personal split", () => {
    const active = activeSkills(solo);
    expect(active).not.toContain("skills/doc-locations.md");
    expect(active).toContain("skills/voice.md");
  });

  it("activates everything when contributor count is unknown — silence is not evidence", () => {
    const unknown = detectStack(facts({ files: ["src/a.ts"], contributors: null }));
    expect(activeSkills(unknown)).toHaveLength(8);
  });
});

describe("renderWstYaml", () => {
  const yaml = renderWstYaml({ backend: "files", skills: activeSkills(tsRepo), namespace: "acme" });

  it("is valid YAML with the fields the loader and the retro read", () => {
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["version"]).toBe(0);
    expect(parsed["backend"]).toBe("files");
    expect(parsed["skills"]).toHaveLength(8);
    expect((parsed["retro"] as Record<string, unknown>)["suggest_after"]).toBe(5);
  });

  it("pins the memory namespace to this repo — a shared namespace cross-contaminates", () => {
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect((parsed["memory"] as Record<string, unknown>)["namespace"]).toBe("acme");
  });

  it("lists the inactive skills as commented-out entries, so they can be switched on later", () => {
    const y = renderWstYaml({ backend: "files", skills: activeSkills(solo), namespace: "solo" });
    expect(y).toContain("# - skills/doc-locations.md");
    expect((parseYaml(y) as Record<string, unknown>)["skills"]).not.toContain(
      "skills/doc-locations.md",
    );
  });
});

describe("renderConstitution", () => {
  const constitution = renderConstitution({
    repoName: "acme",
    date: "2026-08-08",
    purpose: "A billing service for widget subscriptions.",
    risk: { ...NO_RISK, money: true },
    conventions: ["code and docs in English"],
    stack: tsRepo,
  });

  it("carries the interview's answers, not placeholders", () => {
    expect(constitution).toContain("A billing service for widget subscriptions.");
    expect(constitution).toMatch(/money/i);
    expect(constitution).toContain("code and docs in English");
  });

  it("leaves no unresolved template placeholder", () => {
    expect(constitution).not.toMatch(/\{\{|\}\}/);
  });

  it("records the stack facts that were inferred, so they can be corrected", () => {
    expect(constitution).toContain("TypeScript");
    expect(constitution).toContain("pnpm");
  });

  it("states plainly that a greenfield repo has no stack yet", () => {
    const green = renderConstitution({
      repoName: "new",
      date: "2026-08-08",
      purpose: "Nothing yet.",
      risk: NO_RISK,
      conventions: [],
      stack: detectStack(facts()),
    });
    expect(green).toMatch(/greenfield/i);
  });

  it("says who may amend it — the retro never touches the constitution", () => {
    expect(constitution).toMatch(/retro/i);
    expect(constitution).toMatch(/human/i);
  });
});

describe("the memory schema travels with the payload", () => {
  it("documents every required signal field, so no agent has to look it up elsewhere", () => {
    for (const field of ["id", "ts", "type", "phase", "severity", "detail"]) {
      expect(MEMORY_README).toContain(`\`${field}\``);
    }
  });

  it("documents the append-only invariant and how corrections work", () => {
    expect(MEMORY_README).toMatch(/append-only/i);
    expect(MEMORY_README).toContain("supersedes");
  });

  it("gives a copyable example line", () => {
    const line = MEMORY_README.split("\n").find((l) => l.trim().startsWith('{"id":"sig-'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line?.trim() ?? "{}") as Record<string, unknown>;
    expect(parsed["id"]).toMatch(/^sig-\d{4}$/);
    expect(parsed["phase"]).toBeDefined();
  });

  it("ships an ADR template that is a fill-in, not a blank page", () => {
    expect(ADR_TEMPLATE).toContain("## Context");
    expect(ADR_TEMPLATE).toContain("## Decision");
    expect(ADR_TEMPLATE).toContain("## Consequences");
    expect(ADR_TEMPLATE).toMatch(/^---\n/);
  });
});

describe("renderAgentsMd", () => {
  const rules = buildTriageRules(tsRepo, {
    purpose: "p",
    risk: NO_RISK,
    strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
    conventions: [],
  });

  const agents = renderAgentsMd({
    repoName: "acme",
    constitution: renderConstitution({
      repoName: "acme",
      date: "2026-08-08",
      purpose: "A billing service.",
      risk: NO_RISK,
      conventions: [],
      stack: tsRepo,
    }),
    triageRulesMd: renderTriageRulesMd(rules, { date: "2026-08-08" }),
    activeSkills: activeSkills(tsRepo),
    checkIds: ["typecheck", "test"],
  });

  it("inlines the constitution and the triage table rather than linking to them", () => {
    expect(agents).toContain("A billing service.");
    expect(agents).toContain("src/billing/**");
  });

  it("says it is generated and must not be hand-edited", () => {
    expect(agents).toMatch(/generated/i);
    expect(agents).toMatch(/do not edit/i);
  });

  it("lists only the ACTIVE skills", () => {
    const soloAgents = renderAgentsMd({
      repoName: "solo",
      constitution: "x",
      triageRulesMd: "y",
      activeSkills: activeSkills(solo),
      checkIds: [],
    });
    expect(soloAgents).not.toContain("doc-locations");
  });

  it("tells the agent how to record a signal, pointing at the schema that shipped with it", () => {
    expect(agents).toContain(".sdd/memory/signals.jsonl");
    expect(agents).toContain(".sdd/memory/README.md");
  });

  it("names the seeded checks so the gate is not a surprise", () => {
    expect(agents).toContain("typecheck");
  });

  it("CLAUDE.md is an import of AGENTS.md, not a copy of it", () => {
    expect(CLAUDE_MD.trim()).toBe("@AGENTS.md");
  });

  it('never says "this file" — inlined prose must name the file it means', () => {
    // The constitution and the triage table are both inlined here. A sentence
    // reading "this file is amended only by a human" is true in
    // `.sdd/constitution.md` and false in `AGENTS.md`, which is generated and
    // overwritten. Referring by name is the only rendering that stays true.
    expect(agents.toLowerCase()).not.toMatch(/\bthis file\b/);
  });
});
