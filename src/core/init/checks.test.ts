import { describe, expect, it } from "vitest";
import { buildRegistry, parseCheckFile } from "../checks/registry.js";
import { detectStack, type RepoFacts } from "./detect.js";
import { seedChecks } from "./checks.js";

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
    packageJson: {
      scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." },
    },
  }),
);

/**
 * Where the code lives is DECLARED now, not detected. `include` arrives as the
 * globs somebody answered with, so these options carry them the way `planInit`
 * does.
 */
const seeded = { date: "2026-08-08", include: ["src/**"] } as const;

/** Every seeded file must load through the real loader, under its real filename. */
const load = (files: ReturnType<typeof seedChecks>) =>
  files.map((f) => parseCheckFile(f.path.split("/").pop() ?? "", f.contents));

describe("seedChecks — round-trips through the real registry loader", () => {
  it("every generated check file parses, and the registry builds from them", () => {
    const checks = load(seedChecks(tsRepo, seeded));
    expect(checks.length).toBeGreaterThan(0);
    const registry = buildRegistry(checks);
    expect(registry.active.length).toBe(checks.length);
  });

  it("writes every file under .wst/checks/<id>.md so the id matches the filename stem", () => {
    for (const file of seedChecks(tsRepo, seeded)) {
      expect(file.path).toMatch(/^\.wst\/checks\/[a-z0-9-]+\.md$/);
    }
  });

  it("seeds typecheck, test and lint for a TS repo that declares all three scripts", () => {
    const ids = load(seedChecks(tsRepo, seeded)).map((c) => c.id).sort();
    expect(ids).toEqual(["lint", "test", "typecheck"]);
  });

  it("bakes in the DETECTED command, not a guess", () => {
    const checks = load(seedChecks(tsRepo, seeded));
    expect(checks.find((c) => c.id === "test")?.command).toBe("pnpm run test");
    expect(checks.find((c) => c.id === "typecheck")?.command).toBe("pnpm run typecheck");
  });
});

describe("seedChecks — never seed a check that cannot run", () => {
  it("seeds NOTHING for a repo with no package.json, no tests and no typechecker", () => {
    expect(seedChecks(detectStack(facts()), seeded)).toEqual([]);
  });

  it("seeds nothing for a Python repo whose runner it could not identify", () => {
    const python = detectStack(facts({ files: ["pyproject.toml", "src/app.py"] }));
    expect(seedChecks(python, seeded)).toEqual([]);
  });

  it("seeds nothing when nobody said where the code lives", () => {
    // A check with no `include` would have to declare `**`, which matches build
    // output and vendored code — and is not even the catch-all it looks like,
    // since `**` does not cross a dot-leading segment. Silence is the answer.
    expect(seedChecks(tsRepo, { date: "2026-08-08", include: [] })).toEqual([]);
  });

  it("omits the test check when the only test script is npm's placeholder", () => {
    const stack = detectStack(
      facts({
        files: ["package.json", "tsconfig.json", "src/a.ts"],
        packageJson: {
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
          devDependencies: { typescript: "^5" },
        },
      }),
    );
    const ids = load(seedChecks(stack, seeded)).map((c) => c.id);
    expect(ids).not.toContain("test");
    expect(ids).toContain("typecheck");
  });

  it("seeds a test check for a repo with a runner but no tests yet, held at warn", () => {
    // A `block`ing test check in a repo with zero tests blocks nothing today and
    // surprises someone the day they add the first one. Warn is the honest level
    // until tests actually exist.
    const stack = detectStack(
      facts({
        files: ["package.json", "src/a.ts"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    const test = load(seedChecks(stack, seeded)).find((c) => c.id === "test");
    expect(test?.severity).toBe("warn");
  });

  it("lets the test check block once the repo actually has tests", () => {
    const test = load(seedChecks(tsRepo, seeded)).find((c) => c.id === "test");
    expect(test?.severity).toBe("block");
  });
});

describe("seedChecks — the agent-lens rule", () => {
  it("seeds no agent-lens check by default — apparatus is earned, not sprayed", () => {
    const kinds = load(seedChecks(tsRepo, seeded)).map((c) => c.kind);
    expect(kinds).not.toContain("agent-lens");
  });

  it("seeds one on request, uncalibrated and capped at warn", () => {
    const checks = load(seedChecks(tsRepo, { ...seeded, agentLens: true }));
    const lens = checks.find((c) => c.kind === "agent-lens");
    expect(lens).toBeDefined();
    expect(lens?.severity).toBe("warn");
  });

  it("NEVER emits an agent-lens check at severity block, whatever it is asked for", () => {
    // The schema would refuse it (no calibration receipt exists in a fresh repo),
    // so an init that emitted one would produce a repo whose registry will not load.
    const checks = load(
      seedChecks(tsRepo, {
        ...seeded,
        agentLens: true,
        agentLensSeverity: "block",
      }),
    );
    for (const check of checks) {
      if (check.kind === "agent-lens") expect(check.severity).not.toBe("block");
    }
  });

  it("a deterministic check may block freely — that asymmetry is the whole rule", () => {
    const checks = load(seedChecks(tsRepo, seeded));
    expect(checks.filter((c) => c.severity === "block").every((c) => c.kind === "deterministic"))
      .toBe(true);
  });
});

describe("seedChecks — check bodies", () => {
  it("gives every check a body that says what to do when it fails", () => {
    for (const check of load(seedChecks(tsRepo, { ...seeded, agentLens: true }))) {
      expect(check.body.length).toBeGreaterThan(80);
      expect(check.body).toMatch(/when it fails/i);
    }
  });

  it("marks the seeded checks as unearned, so the retro can replace them with real receipts", () => {
    for (const check of load(seedChecks(tsRepo, seeded))) {
      expect(check.origin).toEqual([]);
      expect(check.body).toMatch(/seeded/i);
    }
  });

  it("scopes include globs to the DECLARED source layout, verbatim", () => {
    const checks = load(
      seedChecks(tsRepo, { date: "2026-08-08", include: ["apps/*/src/**"] }),
    );
    for (const check of checks) expect(check.include).toEqual(["apps/*/src/**"]);
  });
});
