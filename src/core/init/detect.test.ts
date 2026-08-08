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
