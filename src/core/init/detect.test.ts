import { describe, expect, it } from "vitest";
import { detectStack, type RepoFacts } from "./detect.js";

const facts = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  repoName: "acme",
  files: [],
  packageJson: null,
  commitSubjects: [],
  contributors: null,
  ...over,
});

describe("detectStack — greenfield vs brownfield", () => {
  it("calls an empty repo greenfield and infers nothing it cannot see", () => {
    const stack = detectStack(facts());
    expect(stack.greenness).toBe("greenfield");
    expect(stack.language).toBeNull();
    expect(stack.packageManager).toBeNull();
    expect(stack.commands).toEqual({ test: null, typecheck: null, lint: null });
    expect(stack.sourceGlobs).toEqual([]);
  });

  it("a repo with only a README is still greenfield", () => {
    expect(detectStack(facts({ files: ["README.md", ".gitignore"] })).greenness).toBe("greenfield");
  });

  it("one source file makes it brownfield", () => {
    expect(detectStack(facts({ files: ["README.md", "src/index.ts"] })).greenness).toBe("brownfield");
  });

  it("a package.json alone makes it brownfield — the project has declared itself", () => {
    expect(detectStack(facts({ files: ["package.json"], packageJson: {} })).greenness).toBe(
      "brownfield",
    );
  });
});

describe("detectStack — language and package manager", () => {
  it("infers TypeScript from tsconfig.json", () => {
    const stack = detectStack(
      facts({ files: ["package.json", "tsconfig.json", "src/a.ts"], packageJson: {} }),
    );
    expect(stack.language).toBe("TypeScript");
  });

  it("infers JavaScript from a package.json with no tsconfig and no .ts files", () => {
    const stack = detectStack(facts({ files: ["package.json", "src/a.js"], packageJson: {} }));
    expect(stack.language).toBe("JavaScript");
  });

  it("infers Go from go.mod, Rust from Cargo.toml, Python from pyproject.toml", () => {
    expect(detectStack(facts({ files: ["go.mod", "main.go"] })).language).toBe("Go");
    expect(detectStack(facts({ files: ["Cargo.toml", "src/main.rs"] })).language).toBe("Rust");
    expect(detectStack(facts({ files: ["pyproject.toml", "src/app.py"] })).language).toBe("Python");
  });

  it("reads the package manager off the lockfile", () => {
    const pm = (lock: string) =>
      detectStack(facts({ files: ["package.json", lock], packageJson: {} })).packageManager;
    expect(pm("pnpm-lock.yaml")).toBe("pnpm");
    expect(pm("yarn.lock")).toBe("yarn");
    expect(pm("bun.lock")).toBe("bun");
    expect(pm("package-lock.json")).toBe("npm");
  });

  it("lets the corepack `packageManager` field win over a stale lockfile", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "package-lock.json"],
        packageJson: { packageManager: "yarn@4.1.0" },
      }),
    );
    expect(stack.packageManager).toBe("yarn");
  });

  it("defaults a package.json with no lockfile to npm", () => {
    expect(detectStack(facts({ files: ["package.json"], packageJson: {} })).packageManager).toBe(
      "npm",
    );
  });
});

describe("detectStack — commands (a seeded check must never run a command that does not exist)", () => {
  it("takes test/typecheck/lint from package.json scripts, prefixed with the package manager", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/a.ts"],
        packageJson: {
          scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." },
        },
      }),
    );
    expect(stack.commands).toEqual({
      test: "pnpm run test",
      typecheck: "pnpm run typecheck",
      lint: "pnpm run lint",
    });
  });

  it("REFUSES npm's placeholder test script — seeding it would fail the gate on every run", () => {
    const stack = detectStack(
      facts({
        files: ["package.json"],
        packageJson: { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
      }),
    );
    expect(stack.commands.test).toBeNull();
  });

  it("accepts `type-check` as a spelling of `typecheck`", () => {
    const stack = detectStack(
      facts({ files: ["package.json"], packageJson: { scripts: { "type-check": "tsc --noEmit" } } }),
    );
    expect(stack.commands.typecheck).toBe("npm run type-check");
  });

  it("falls back to tsc only when typescript is actually a declared dependency", () => {
    const withDep = detectStack(
      facts({
        files: ["package.json", "tsconfig.json", "src/a.ts"],
        packageJson: { devDependencies: { typescript: "^5.4.0" } },
      }),
    );
    expect(withDep.commands.typecheck).toBe("npx --no-install tsc --noEmit");

    const withoutDep = detectStack(
      facts({ files: ["package.json", "tsconfig.json", "src/a.ts"], packageJson: {} }),
    );
    expect(withoutDep.commands.typecheck).toBeNull();
  });

  it("uses the toolchain's built-in commands for Go and Rust", () => {
    expect(detectStack(facts({ files: ["go.mod", "main.go"] })).commands).toEqual({
      test: "go test ./...",
      typecheck: "go build ./...",
      lint: "go vet ./...",
    });
    expect(detectStack(facts({ files: ["Cargo.toml", "src/main.rs"] })).commands).toEqual({
      test: "cargo test",
      typecheck: "cargo check",
      lint: null,
    });
  });

  it("admits it does not know a Python project's runner rather than guessing one", () => {
    const stack = detectStack(facts({ files: ["pyproject.toml", "src/app.py"] }));
    expect(stack.commands).toEqual({ test: null, typecheck: null, lint: null });
  });
});

describe("detectStack — layout, CI and commit style", () => {
  it("names the source directories it found, and only those", () => {
    const stack = detectStack(
      facts({ files: ["src/a.ts", "lib/b.ts", "docs/x.md", "package.json"], packageJson: {} }),
    );
    expect(stack.sourceGlobs).toEqual(["src/**", "lib/**"]);
  });

  it("detects that tests exist, and where", () => {
    const stack = detectStack(
      facts({ files: ["src/a.ts", "src/a.test.ts", "package.json"], packageJson: {} }),
    );
    expect(stack.hasTests).toBe(true);
  });

  it("reports no tests for a repo that has none", () => {
    const stack = detectStack(facts({ files: ["src/a.ts", "package.json"], packageJson: {} }));
    expect(stack.hasTests).toBe(false);
  });

  it("recognises CI from its config path", () => {
    expect(detectStack(facts({ files: [".github/workflows/ci.yml"] })).ci).toBe("GitHub Actions");
    expect(detectStack(facts({ files: [".gitlab-ci.yml"] })).ci).toBe("GitLab CI");
    expect(detectStack(facts({ files: ["README.md"] })).ci).toBeNull();
  });

  it("calls the commit style conventional only with enough evidence", () => {
    const conventional = [
      "feat(core): add triage",
      "fix: off-by-one",
      "chore(deps): bump",
      "docs: readme",
    ];
    expect(detectStack(facts({ commitSubjects: conventional })).commitStyle).toBe("conventional");
    // Two commits is not a style, it is a coincidence.
    expect(detectStack(facts({ commitSubjects: conventional.slice(0, 2) })).commitStyle).toBe(
      "unknown",
    );
    expect(
      detectStack(facts({ commitSubjects: ["wip", "more stuff", "fixed it", "asdf"] })).commitStyle,
    ).toBe("unknown");
  });

  it("records evidence for every inference, so the plan is auditable", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/a.ts"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    expect(stack.evidence.join("\n")).toContain("tsconfig.json");
    expect(stack.evidence.join("\n")).toContain("pnpm-lock.yaml");
  });

  it("records evidence for EVERY command it found, not just some of them", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "tsconfig.json", "src/a.ts"],
        packageJson: { scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } },
      }),
    );
    const evidence = stack.evidence.join("\n");
    for (const command of Object.values(stack.commands)) {
      if (command !== null) expect(evidence).toContain(command);
    }
  });
});

/**
 * A monorepo keeps its code where its root manifest says it does. Reading that
 * declaration is the difference between naming the application code and naming
 * nothing at all — and `sourceGlobs` being empty is not a cosmetic loss: it is
 * what makes `triage.yaml` emit no rule over the source, the strict-paths
 * question lose its default, and a check's `include` fall back to the unscoped
 * `**​/*.ts` that `checks.ts` exists to avoid.
 */
describe("detectStack — workspaces", () => {
  const sift = (over: Partial<RepoFacts> = {}): RepoFacts =>
    facts({
      files: [
        "package.json",
        "package-lock.json",
        "tsconfig.base.json",
        "apps/api/package.json",
        "apps/api/src/index.ts",
        "apps/api/src/llm/__tests__/retry.test.ts",
        "apps/web/package.json",
        "apps/web/src/App.tsx",
        "packages/shared/package.json",
        "packages/shared/src/index.ts",
        "plan/package.json",
        "plan/README.md",
      ],
      packageJson: { workspaces: ["apps/*", "packages/*"] },
      ...over,
    });

  it("scopes the source globs to the workspaces the root manifest declares", () => {
    expect(detectStack(sift()).sourceGlobs).toEqual(["apps/*/src/**", "packages/*/src/**"]);
  });

  it("keeps a check's include scoped, instead of falling back to the whole repo", () => {
    const globs = detectStack(sift()).sourceFileGlobs;
    expect(globs).toEqual([
      "apps/*/src/**/*.ts",
      "apps/*/src/**/*.tsx",
      "packages/*/src/**/*.ts",
      "packages/*/src/**/*.tsx",
    ]);
    expect(globs).not.toContain("**/*.ts");
  });

  it("names only the workspaces — a sibling directory with a package.json is not one", () => {
    // `plan/` carries a package.json and holds no application code. It is
    // excluded because the root manifest does not declare it, which is the whole
    // reason for reading the declaration instead of guessing at directory names.
    for (const glob of detectStack(sift()).sourceGlobs) expect(glob).not.toContain("plan");
  });

  it("ignores a declared workspace pattern that matches nothing on disk", () => {
    const stack = detectStack(
      sift({ packageJson: { workspaces: ["apps/*", "packages/*", "services/*"] } }),
    );
    expect(stack.sourceGlobs).toEqual(["apps/*/src/**", "packages/*/src/**"]);
  });

  it("honours a negated workspace pattern", () => {
    const stack = detectStack(
      sift({
        files: [
          "package.json",
          "apps/api/package.json",
          "apps/api/src/index.ts",
          "apps/legacy/package.json",
          "apps/legacy/lib/old.ts",
        ],
        packageJson: { workspaces: ["apps/*", "!apps/legacy"] },
      }),
    );
    expect(stack.sourceGlobs).toEqual(["apps/*/src/**"]);
  });

  it("reads yarn's `workspaces.packages` spelling too", () => {
    const stack = detectStack(sift({ packageJson: { workspaces: { packages: ["apps/*"] } } }));
    expect(stack.sourceGlobs).toEqual(["apps/*/src/**"]);
  });

  it("falls back to the package root when a workspace has no recognisable source dir", () => {
    const stack = detectStack(
      sift({
        files: ["package.json", "packages/tiny/package.json", "packages/tiny/index.ts"],
        packageJson: { workspaces: ["packages/*"] },
      }),
    );
    expect(stack.sourceGlobs).toEqual(["packages/*/**"]);
  });

  it("keeps a root source dir alongside the workspaces, most specific last", () => {
    const stack = detectStack(
      sift({
        files: [
          "package.json",
          "src/cli.ts",
          "apps/api/package.json",
          "apps/api/src/index.ts",
        ],
        packageJson: { workspaces: ["apps/*"] },
      }),
    );
    expect(stack.sourceGlobs).toEqual(["src/**", "apps/*/src/**"]);
  });

  it("says in the evidence that the layout came from the declared workspaces", () => {
    expect(detectStack(sift()).evidence.join("\n")).toContain("workspaces");
  });

  it("leaves a flat repo exactly as it was — src/ at the root, no workspaces", () => {
    // Whetstone's own shape. The regression fixture for all of the above.
    const stack = detectStack(
      facts({
        files: ["package.json", "tsconfig.json", "src/cli.ts", "src/core/init/detect.ts"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    expect(stack.sourceGlobs).toEqual(["src/**"]);
    expect(stack.sourceFileGlobs).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("ignores a `workspaces` field that is not a list of strings", () => {
    const stack = detectStack(
      facts({ files: ["package.json", "src/a.ts"], packageJson: { workspaces: "apps/*" } }),
    );
    expect(stack.sourceGlobs).toEqual(["src/**"]);
  });
});
