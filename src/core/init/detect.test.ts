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

/**
 * WHAT USED TO BE TESTED HERE (ADR-0016): `greenness`, `language`, `sourceGlobs`,
 * `sourceFileGlobs`, `ci`, `commitStyle` and `solo` — six describe blocks, one of
 * them the whole workspace-layout suite. Those facts are not detected any more,
 * so the tests pinning them went out with the tables that produced them. What is
 * left is what a repo actually declares about itself.
 */
describe("detectStack — a repo that declares nothing", () => {
  it("reads nothing, and says nothing, rather than filling the gaps", () => {
    const stack = detectStack(facts());
    expect(stack.packageManager).toBeNull();
    expect(stack.commands).toEqual({ test: null, typecheck: null, lint: null });
    expect(stack.hasTests).toBe(false);
    expect(stack.evidence).toEqual([]);
  });

  it("stays silent about a repo that is only prose", () => {
    expect(detectStack(facts({ files: ["README.md", ".gitignore"] })).evidence).toEqual([]);
  });
});

describe("detectStack — package manager", () => {
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

  it("defaults a package.json with no lockfile to npm, and says it assumed that", () => {
    const stack = detectStack(facts({ files: ["package.json"], packageJson: {} }));
    expect(stack.packageManager).toBe("npm");
    expect(stack.evidence.join("\n")).toMatch(/assumed/);
  });

  it("names the tool a manifest names, for the toolchains that ship one", () => {
    expect(detectStack(facts({ files: ["go.mod"] })).packageManager).toBe("go");
    expect(detectStack(facts({ files: ["Cargo.toml"] })).packageManager).toBe("cargo");
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

  it("uses the toolchain's built-in commands when a manifest names the toolchain", () => {
    // `go.mod` states this is a Go module. That is a declaration, not a count of
    // how many `.go` files happen to be lying around.
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

describe("detectStack — tests and evidence", () => {
  it("detects that tests exist", () => {
    const stack = detectStack(
      facts({ files: ["src/a.ts", "src/a.test.ts", "package.json"], packageJson: {} }),
    );
    expect(stack.hasTests).toBe(true);
  });

  it("reports no tests for a repo that has none", () => {
    const stack = detectStack(facts({ files: ["src/a.ts", "package.json"], packageJson: {} }));
    expect(stack.hasTests).toBe(false);
  });

  it("recognises a test directory as well as a test file suffix", () => {
    expect(detectStack(facts({ files: ["tests/api_test.go", "go.mod"] })).hasTests).toBe(true);
    expect(detectStack(facts({ files: ["test_thing.py", "pyproject.toml"] })).hasTests).toBe(true);
  });

  it("names the file every reading came from, so the plan is auditable", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/a.ts"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    expect(stack.evidence.join("\n")).toContain("pnpm-lock.yaml");
    expect(stack.evidence.join("\n")).toContain("package.json scripts");
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
 * A seeded command inherits the repo's judgment, and the repo can be wrong.
 *
 * One real install's `lint` script was `eslint --fix <glob>`. Seeded verbatim,
 * that is a check that rewrites the tree while judging it: it reports on a file
 * that no longer exists in the form the author wrote it, and it hides the finding
 * it was meant to surface. That repo's own instructions did not warn about it —
 * they prescribed the lint script as a verification step — so nothing there
 * compensates. The flag is visible in the script text, and that is enough.
 */
describe("detectStack — commands that rewrite the tree", () => {
  const withScripts = (scripts: Record<string, string>) =>
    detectStack(
      facts({
        files: ["package.json", "package-lock.json", "src/a.ts", "src/a.test.ts"],
        packageJson: { scripts },
      }),
    );

  it("names a lint script that carries --fix", () => {
    const facts = withScripts({ lint: "eslint --fix './src/**/*.ts'" });

    expect(facts.mutating).toContain("lint");
  });

  it("names a test script that rewrites snapshots", () => {
    // `jest -u` overwrites the snapshots it is comparing against, so it cannot fail.
    expect(withScripts({ test: "jest -u" }).mutating).toContain("test");
  });

  it("names --write, and -w, which means write in some tools and watch in others", () => {
    expect(withScripts({ lint: "prettier --write ." }).mutating).toContain("lint");
    expect(withScripts({ lint: "prettier -w ." }).mutating).toContain("lint");
  });

  it("leaves a read-only command alone", () => {
    const facts = withScripts({ lint: "eslint .", test: "vitest run", typecheck: "tsc --noEmit" });

    expect(facts.mutating).toEqual([]);
  });

  it("does not mistake --fix-dry-run or --check for a write", () => {
    const facts = withScripts({ lint: "eslint --fix-dry-run .", test: "prettier --check ." });

    expect(facts.mutating).toEqual([]);
  });
});
