import { describe, expect, it } from "vitest";
import { buildRegistry, parseCheckFile } from "../checks/registry.js";
import { detectStack, type RepoFacts, type StackFacts } from "./detect.js";
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
    expect(registry.all.length).toBe(checks.length);
  });

  it("writes every file under .wst/checks/<id>.md so the id matches the filename stem", () => {
    for (const file of seedChecks(tsRepo, seeded)) {
      expect(file.path).toMatch(/^\.wst\/checks\/[a-z0-9-]+\.md$/);
    }
  });

  it("seeds typecheck, test and lint for a TS repo that declares all three scripts", () => {
    const ids = load(seedChecks(tsRepo, seeded)).map((c) => c.id).sort();
    expect(ids).toEqual(["comment-density", "lint", "test", "typecheck"]);
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

  it("still holds the test check at warn when tests exist, having never seen them pass", () => {
    // Reversed on 2026-08-15. This used to assert `block`, on the reasoning that
    // test files existing is evidence enough. A real install proved otherwise: a quarter of
    // that suite opened a database nobody had started, so the gate was red on
    // every machine. Test files exist is not the suite passes.
    const test = load(seedChecks(tsRepo, seeded)).find((c) => c.id === "test");
    expect(test?.severity).toBe("warn");
  });
});

describe("seedChecks — the llm rule", () => {
  it("seeds no llm check by default — apparatus is earned, not sprayed", () => {
    const kinds = load(seedChecks(tsRepo, seeded)).map((c) => c.kind);
    expect(kinds).not.toContain("llm");
  });

  it("seeds one on request, uncalibrated and capped at warn", () => {
    const checks = load(seedChecks(tsRepo, { ...seeded, agentLens: true }));
    const lens = checks.find((c) => c.kind === "llm");
    expect(lens).toBeDefined();
    expect(lens?.severity).toBe("warn");
  });

  it("NEVER emits an llm check at severity block, whatever it is asked for", () => {
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
      if (check.kind === "llm") expect(check.severity).not.toBe("block");
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

  it("marks a check read off this repo as unearned, so a retro can give it a real receipt", () => {
    // Empty `origin` is the schema's word for "nothing here asked for this". A
    // check derived from a declared script is exactly that.
    for (const check of load(seedChecks(tsRepo, seeded))) {
      if (check.id === "comment-density") continue;
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

/**
 * Two defects from one install into a repo Whetstone did not grow up in, both from
 * `init` trusting what `package.json` declared without reading it (`sig-0043`).
 */
describe("seedChecks — what init may not assume about a repo's own scripts", () => {
  const facts = (over: Partial<StackFacts> = {}): StackFacts => ({
    packageManager: "npm",
    commands: { test: "npm run test", typecheck: null, lint: "npm run lint" },
    hasTests: true,
    mutating: [],
    evidence: [],
    ...over,
  });
  const fileFor = (id: string, over: Partial<StackFacts> = {}) =>
    seedChecks(facts(over), seeded).find((f) => f.path.endsWith(`${id}.md`));

  it("never seeds `test` at block, because it has not seen the suite pass", () => {
    // Seeded at `block` on the evidence that test FILES exist. In that repo a
    // quarter of the suite opened a database nobody had started, so the gate was
    // red on every machine — and a check that is red everywhere gets routed
    // around, after which it stops catching the real findings too.
    expect(fileFor("test")?.contents).toContain("severity: warn");
  });

  it("says what promotes `test`, so warn is a step and not a resting place", () => {
    expect(fileFor("test")?.contents).toMatch(/first green gate/i);
  });

  it("seeds a mutating command disabled rather than letting it rewrite the tree", () => {
    const lint = fileFor("lint", { mutating: ["lint"] })?.contents ?? "";

    expect(lint).toContain("enabled: false");
    expect(lint).toMatch(/rewrites the tree/i);
  });

  it("leaves a read-only lint enabled and at warn", () => {
    const lint = fileFor("lint")?.contents ?? "";

    expect(lint).not.toContain("enabled: false");
    expect(lint).toContain("severity: warn");
  });
});

/**
 * adr-0030. The category `opinion` is gone; what it named is a check whose
 * `origin` says it was earned somewhere else, and it arrives switched off.
 */
describe("seedChecks — the check Whetstone brings", () => {
  const file = (over: Partial<Parameters<typeof seedChecks>[1]> = {}) =>
    seedChecks(tsRepo, { ...seeded, ...over }).find((f) => f.path.endsWith("comment-density.md"));

  it("carries the signal that earned it, not an empty origin", () => {
    expect(file()?.contents).toContain(`origin: ["sig-4a2610fb"]`);
  });

  it("arrives disabled, so no repo gains a check it never asked to be judged by", () => {
    expect(file()?.contents).toContain("enabled: false");
  });

  it("says on the page that it is off and what turns it on", () => {
    const contents = file()?.contents ?? "";
    expect(contents).toMatch(/enabled: false/);
    expect(contents).toMatch(/delete `enabled: false`/i);
  });

  it("names a command the target repo has, not a script nobody wrote there", () => {
    // The blocker adr-0025 hit: `npm run check:comments` names nothing in a repo
    // Whetstone did not write, so the seeded check fails on every run.
    expect(file()?.contents).toContain("wst check run comment-density");
    expect(file()?.contents).not.toContain("npm run check");
  });

  it("refuses a receipt, because its answer depends on the range and not on a file", () => {
    expect(file()?.contents).toContain("skippable: false");
  });

  it("cites no decision id, which would dangle in a repo that has none of ours", () => {
    // ADR-0004. A signal id is a label beside its own description and survives;
    // a decision id is a pointer a reader is expected to follow.
    expect(file()?.contents).not.toMatch(/\badr-\d{4}\b/i);
  });

  it("uses no em-dash, same as every other page init writes into a target repo", () => {
    expect(file()?.contents).not.toContain("\u2014");
  });

  it("is not seeded where no typecheck script was declared, since it reads .ts only", () => {
    const noTs = detectStack(
      facts({
        files: ["package.json", "src/app.js"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    expect(seedChecks(noTs, seeded).map((f) => f.path)).not.toContain(
      ".wst/checks/comment-density.md",
    );
  });
});
