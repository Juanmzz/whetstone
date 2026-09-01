import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { detectStack, type RepoFacts } from "./detect.js";
import { NO_RISK } from "./interview.js";
import { buildTriageRules } from "./triage.js";
import {
  renderRootGitignoreStanza,
  renderWstGitignore,
  ROOT_GITIGNORE_ENTRIES,
  renderWstYaml,
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

describe("renderWstYaml", () => {
  const yaml = renderWstYaml({ backend: "files", namespace: "acme" });

  it("is valid YAML with the two fields a new installation actually has", () => {
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["version"]).toBe(0);
    expect(parsed["backend"]).toBe("files");
  });

  it("pins the memory namespace to this repo — a shared namespace cross-contaminates", () => {
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect((parsed["memory"] as Record<string, unknown>)["namespace"]).toBe("acme");
  });

  it("names no judge and no skills, because it installs neither", () => {
    // A key configuring a lens in a repo with no lens is configuration for
    // something that is not there, and a reader cannot tell it from a real setting.
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed["agent"]).toBeUndefined();
    expect(parsed["skills"]).toBeUndefined();
    expect(yaml).not.toContain("skills/");
  });

  it("still writes a judge where a caller asks for one", () => {
    const y = renderWstYaml({ backend: "files", namespace: "acme", agent: "codex" });
    expect((parseYaml(y) as Record<string, unknown>)["agent"]).toBe("codex");
  });
});

describe("runtime state the target repo must never commit", () => {
  describe("renderWstGitignore — .wst/.gitignore", () => {
    const gitignore = renderWstGitignore();

    it("ignores the compiled check index and the receipts cache", () => {
      expect(gitignore.split("\n").map((l) => l.trim())).toEqual(
        expect.arrayContaining(["checks/_index.json", "receipts/"]),
      );
    });

    it("does not ignore signals.jsonl — that page is committed on purpose", () => {
      expect(gitignore).not.toMatch(/signals\.jsonl/);
    });

    it("uses no em-dash, same as every other page init writes into a target repo", () => {
      expect(gitignore).not.toContain("—");
    });
  });


  describe("renderRootGitignoreStanza — .wst-lane", () => {
    it("ignores the lane file a worker writes at the worktree root", () => {
      expect(ROOT_GITIGNORE_ENTRIES).toEqual([".wst-lane"]);
      expect(renderRootGitignoreStanza()).toContain(".wst-lane");
    });

    it("renders only what it is given, so init can append just what is missing", () => {
      expect(renderRootGitignoreStanza([])).not.toContain(".wst-lane");
    });

    it("uses no em-dash", () => {
      expect(renderRootGitignoreStanza()).not.toContain("—");
    });
  });
});
