import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { detectStack, type RepoFacts } from "./detect.js";
import { NO_RISK } from "./interview.js";
import { buildTriageRules, renderTriageRulesMd } from "./triage.js";
import {
  payloadSkill,
  renderDecisionsMd,
  renderRootGitignoreStanza,
  renderWstGitignore,
  CLAUDE_MD,
  MEMORY_README,
  ROOT_GITIGNORE_ENTRIES,
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

describe("skills", () => {
  it("copies all eight skills verbatim, whatever is active", () => {
    expect(SKILL_FILES).toHaveLength(8);
    const copies = skillCopies();
    expect(copies).toHaveLength(8);
    for (const copy of copies) {
      expect(copy.to).toMatch(/^\.wst\/skills\/[a-z-]+\.md$/);
      expect(copy.from).toBe(copy.to.replace(".wst/", ""));
    }
  });

  /**
   * All eight, always. The one deactivation that used to happen at init keyed off
   * a contributor count — `doc-locations` was switched off for "solo" repos —
   * and a headcount read from `git shortlog` is a guess about how a project
   * works, not a fact it declares. Nothing asks for it now, and the honest
   * default is the one the old code already used for an unknown count: on.
   */
  it("activates all eight, and needs nothing about the repo to decide that", () => {
    expect(activeSkills()).toHaveLength(8);
    expect(activeSkills()).toContain("skills/doc-locations.md");
  });
});

describe("renderWstYaml", () => {
  const yaml = renderWstYaml({ backend: "files", skills: activeSkills(), namespace: "acme" });

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
    const y = renderWstYaml({
      backend: "files",
      skills: activeSkills().filter((s) => s !== "skills/doc-locations.md"),
      namespace: "solo",
    });
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
    detected: tsRepo,
    declared: "TypeScript on Node 24, deployed to Fly.io.",
  });

  it("carries the interview's answers, not placeholders", () => {
    expect(constitution).toContain("A billing service for widget subscriptions.");
    expect(constitution).toMatch(/money/i);
    expect(constitution).toContain("code and docs in English");
  });

  it("leaves no unresolved template placeholder", () => {
    expect(constitution).not.toMatch(/\{\{|\}\}/);
  });

  it("prints the stack as it was DECLARED, not as it was guessed from file extensions", () => {
    expect(constitution).toContain("TypeScript on Node 24, deployed to Fly.io.");
  });

  it("prints the facts it actually read, so a wrong one can be corrected", () => {
    expect(constitution).toContain("pnpm");
    expect(constitution).toContain("pnpm run test");
  });

  it("leaves the stack blank, and says so, when nobody stated one", () => {
    // A blank a human fills beats a table's confident wrong answer. What it may
    // not do is stay silent, which reads as "there was nothing to say".
    const green = renderConstitution({
      repoName: "new",
      date: "2026-08-08",
      purpose: "Nothing yet.",
      risk: NO_RISK,
      conventions: [],
      detected: detectStack(facts()),
      declared: null,
    });
    expect(green).toMatch(/not stated/i);
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

  it("documents `branch`, or a hand-written line loses the unit of work the gate records", () => {
    // ADR-0004: the payload is self-contained. A target repo whose gate writes a
    // field its own schema never mentions has a documented schema that is wrong,
    // and the drift is invisible until someone hand-writes a line without it.
    expect(MEMORY_README).toContain("`branch`");
  });

  it("gives a copyable example line", () => {
    const line = MEMORY_README.split("\n").find((l) => l.trim().startsWith('{"id":"sig-'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line?.trim() ?? "{}") as Record<string, unknown>;
    expect(parsed["id"]).toMatch(/^sig-\d{4}$/);
    expect(parsed["phase"]).toBeDefined();
    // Copied verbatim more often than it is read, so the example is where the
    // field either survives into a target repo's log or quietly does not.
    expect(parsed["branch"]).toBeTypeOf("string");
  });

  it("dates the seeded page from the clock, not with a placeholder to fill in", () => {
    // The only generated file that ever carried `YYYY-MM-DD`. A template is a
    // fill-in; this page is a file init writes, and it knows what day it is.
    const page = renderDecisionsMd({ date: "2026-08-14" });

    expect(page).toContain("generated: 2026-08-14");
    expect(page).not.toContain("ts: YYYY-MM-DD");
  });

  it("seeds a decision page shaped like the one it will grow into", () => {
    // The `recording.md` this same payload copies tells the reader to add an
    // entry to `memory/decisions.md`. Seeding a directory of files instead
    // hands a target repo a shape its own rules do not describe.
    expect(renderDecisionsMd({ date: "2026-08-14" })).toMatch(/^---\n/);
    expect(renderDecisionsMd({ date: "2026-08-14" })).toContain("### adr-NNNN");
    expect(renderDecisionsMd({ date: "2026-08-14" })).toContain("`accepted` · YYYY-MM-DD");
  });

  it("says what an entry keeps, since that is the whole reason to write one", () => {
    expect(renderDecisionsMd({ date: "2026-08-14" })).toMatch(/rejected/i);
  });

  it("holds no entry of its own — a seeded decision is a decision nobody made", () => {
    expect(renderDecisionsMd({ date: "2026-08-14" })).not.toMatch(/^### adr-\d{4}/m);
  });

  it("uses no em-dash — this page lands in a repo that may forbid them by convention", () => {
    expect(renderDecisionsMd({ date: "2026-08-14" })).not.toContain("—");
  });
});

describe("runtime state the target repo must never commit", () => {
  describe("renderWstGitignore — .wst/.gitignore", () => {
    const gitignore = renderWstGitignore();

    it("ignores the compiled check index, the event log and the receipts cache", () => {
      expect(gitignore.split("\n").map((l) => l.trim())).toEqual(
        expect.arrayContaining(["checks/_index.json", "events.jsonl", "receipts/"]),
      );
    });

    it("does not ignore signals.jsonl — that page is committed on purpose", () => {
      expect(gitignore).not.toMatch(/signals\.jsonl/);
    });

    it("uses no em-dash, same as every other page init writes into a target repo", () => {
      expect(gitignore).not.toContain("—");
    });
  });

  describe("renderRootGitignoreStanza — .wst-charter.md and .wst-lane", () => {
    it("ignores both files `wst prepare` writes into a leased worktree", () => {
      expect(ROOT_GITIGNORE_ENTRIES).toEqual([".wst-charter.md", ".wst-lane"]);
      const stanza = renderRootGitignoreStanza();
      expect(stanza).toContain(".wst-charter.md");
      expect(stanza).toContain(".wst-lane");
    });

    it("can render only the entries missing from a .gitignore that already exists", () => {
      const stanza = renderRootGitignoreStanza([".wst-lane"]);
      expect(stanza).toContain(".wst-lane");
      expect(stanza).not.toContain(".wst-charter.md");
    });

    it("uses no em-dash", () => {
      expect(renderRootGitignoreStanza()).not.toContain("—");
    });
  });
});

describe("renderAgentsMd", () => {
  const rules = buildTriageRules({
    purpose: "p",
    risk: NO_RISK,
    sourcePaths: ["src/**"],
    strictPaths: [{ glob: "src/billing/**", reason: "moves money" }],
    stack: null,
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
      detected: tsRepo,
      declared: null,
    }),
    triageRulesMd: renderTriageRulesMd(rules, { date: "2026-08-08" }),
    activeSkills: activeSkills(),
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
      activeSkills: activeSkills().filter((s) => s !== "skills/doc-locations.md"),
      checkIds: [],
    });
    expect(soloAgents).not.toContain("doc-locations");
  });

  it("tells the agent how to record a signal, pointing at the schema that shipped with it", () => {
    expect(agents).toContain(".wst/memory/signals.jsonl");
    expect(agents).toContain(".wst/memory/README.md");
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
    // `.wst/constitution.md` and false in `AGENTS.md`, which is generated and
    // overwritten. Referring by name is the only rendering that stays true.
    expect(agents.toLowerCase()).not.toMatch(/\bthis file\b/);
  });
});

/**
 * A skill's changelog is WHETSTONE's history of why that rule changed — it cites
 * this repo's decisions and this repo's signals, none of which exist in a repo
 * being bootstrapped. The rule travels; the argument that produced it does not.
 */
describe("payloadSkill — what a copied skill looks like in someone else's repo", () => {
  const SKILL = [
    "---",
    "id: recording",
    "version: 2",
    "status: active",
    "---",
    "# Recording",
    "",
    "1. [RC1] Record a decision.",
    "",
    "## Changelog",
    "",
    "- v2 (2026-08-14, adr-0019): decisions live on one page.",
    "- v1 (2026-07-11, init): generated elsewhere, per `adr-0001`.",
    "",
  ].join("\n");

  it("keeps the rule", () => {
    expect(payloadSkill(SKILL)).toContain("[RC1] Record a decision.");
  });

  it("drops the entries citing decisions and signals this repo never had", () => {
    const out = payloadSkill(SKILL);

    expect(out).not.toContain("adr-0019");
    expect(out).not.toContain("adr-0001");
  });

  it("leaves a changelog to grow, seeded with where the rule came from", () => {
    const out = payloadSkill(SKILL);

    expect(out).toContain("## Changelog");
    expect(out).toMatch(/- v2 .*init/);
  });

  it("keeps the frontmatter, so the version still means something", () => {
    expect(payloadSkill(SKILL)).toContain("version: 2");
  });

  it("leaves a skill with no changelog alone", () => {
    const bare = "---\nid: x\nversion: 1\nstatus: active\n---\n# X\n\nA rule.\n";

    expect(payloadSkill(bare)).toBe(bare);
  });
});

/**
 * A skill written by hand after `init` is invisible to every agent.
 *
 * `activeSkills()` returned the eight `SKILL_FILES` regardless of what is on
 * disk, and `AGENTS.md` is rendered from it — so a `.wst/skills/dispatch.md`
 * somebody wrote never appeared in the list an agent reads. Reported from real
 * use, where exactly that happened.
 */
describe("activeSkills — what AGENTS.md lists", () => {
  it("lists what is actually there when the shell says", () => {
    const found = activeSkills(["skills/lazy.md", "skills/dispatch.md"]);

    expect(found).toEqual(["skills/lazy.md", "skills/dispatch.md"]);
  });

  it("lists nothing when the directory was read and is empty", () => {
    // Not the same as not having read it. Eight names for a directory with no
    // files is the same defect this function was fixed for, reversed.
    expect(activeSkills([])).toEqual([]);
  });

  it("falls back to the shipped set when nothing was read", () => {
    // `init` writing a fresh repo has no directory to read yet.
    expect(activeSkills()).toContain("skills/lazy.md");
    expect(activeSkills()).toHaveLength(8);
  });

  it("keeps a hand-written skill's blurb absent rather than inventing one", () => {
    const rendered = renderAgentsMd({
      repoName: "acme",
      constitution: "---\nid: c\n---\n# c\n\nBody.",
      triageRulesMd: "---\nid: t\n---\n# t\n\nTable.",
      activeSkills: ["skills/dispatch.md"],
      checkIds: ["test"],
    });

    expect(rendered).toContain("skills/dispatch.md");
    expect(rendered).not.toMatch(/dispatch\.md` — \w/);
  });
});
