import { describe, expect, it } from "vitest";
import { buildRegistry, parseCheckFile } from "../checks/registry.js";
import { detectStack, type RepoFacts, type StackFacts } from "./detect.js";
import { seedChecks, type SeedChecksOptions } from "./checks.js";

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
    expect(ids).toEqual(["comment-density", "commit-message", "lint", "test", "typecheck"]);
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
    declared: { sourceGlobs: [], stack: null },
    ...over,
  });
  const fileFor = (
    id: string,
    over: Partial<StackFacts> = {},
    extra: Partial<SeedChecksOptions> = {},
  ) =>
    seedChecks(facts(over), { ...seeded, ...extra }).find((f) => f.path.endsWith(`${id}.md`));

  it("never seeds `test` at block when it has not seen the suite pass", () => {
    // Seeded at `block` on the evidence that test FILES exist. In that repo a
    // quarter of the suite opened a database nobody had started, so the gate was
    // red on every machine — and a check that is red everywhere gets routed
    // around, after which it stops catching the real findings too.
    expect(fileFor("test")?.contents).toContain("severity: warn");
  });

  it("says what it measured, so a `warn` is a reading and not a resting place", () => {
    // It used to say "promote it after the first green gate", and nothing ever
    // promoted. The severity now comes from a run `init` watched.
    expect(fileFor("test")?.contents).toMatch(/not measured/i);
  });

  it("blocks on the command it watched pass, and warns on the one that failed", () => {
    const probes = {
      test: { ran: true as const, ok: true, exitCode: 0, durationMs: 8000 },
      lint: { ran: true as const, ok: false, exitCode: 1, durationMs: 900 },
    };
    expect(fileFor("test", {}, { probes })?.contents).toMatch(/^severity: block$/m);
    expect(fileFor("lint", {}, { probes })?.contents).toMatch(/^severity: warn$/m);
    expect(fileFor("lint", {}, { probes })?.contents).toMatch(/exit 1/);
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
describe("seedChecks — the commit-message check Whetstone brings", () => {
  const file = () =>
    seedChecks(tsRepo, seeded).find((f) => f.path.endsWith("commit-message.md"));

  it("arrives disabled, like every rule no repo asked for", () => {
    expect(file()?.contents).toContain("enabled: false");
  });

  it("runs on the binary that wrote it, not on a script nobody added", () => {
    expect(file()?.contents).toContain("wst check run commit-message");
  });

  it("refuses a receipt, because its answer depends on the range and not on a file", () => {
    // The same tree over two ranges is two different sets of messages.
    expect(file()?.contents).toContain("skippable: false");
  });

  it("is not gated on a LANGUAGE, unlike the other rule Whetstone brings", () => {
    // `comment-density` reads `.ts` and is seeded only where a typecheck script
    // is declared. A commit message is not a language.
    const noTypecheck = detectStack(
      facts({
        files: ["package.json", "src/a.js", "src/a.test.js"],
        packageJson: { scripts: { test: "vitest run" } },
      }),
    );
    const ids = seedChecks(noTypecheck, seeded).map((f) => f.path);

    expect(ids.some((p) => p.endsWith("comment-density.md"))).toBe(false);
    expect(ids.some((p) => p.endsWith("commit-message.md"))).toBe(true);
  });

  it("is withheld from a repo init understood nothing about", () => {
    // The guard in the other direction. adr-0016: `init` writes what a repo
    // DECLARES, and a checkout with no layout and no runner declared nothing.
    expect(seedChecks(detectStack(facts()), seeded)).toEqual([]);
  });
});

describe("seedChecks — the check Whetstone brings", () => {
  const file = (over: Partial<Parameters<typeof seedChecks>[1]> = {}) =>
    seedChecks(tsRepo, { ...seeded, ...over }).find((f) => f.path.endsWith("comment-density.md"));

  it("carries the signal that earned it, not an empty origin", () => {
    expect(file()?.contents).toContain(`origin: ["sig-4a2610fb"]`);
  });

  it("arrives disabled, so no repo gains a check it never asked to be judged by", () => {
    expect(file()?.contents).toContain("enabled: false");
  });

  it("arrives on, at warn, and says how to switch it off", () => {
    // Seeded OFF, it was a rule nobody ever saw. `init` shows what it is about to
    // seed before it writes, so the offer can be declined where it is made.
    const contents = file()?.contents ?? "";
    expect(contents).not.toMatch(/^enabled: false$/m);
    expect(contents).toMatch(/^severity: warn$/m);
    expect(contents).toMatch(/`enabled: false`/);
  });

  it("names a command the target repo has, not a script nobody wrote there", () => {
    // The blocker adr-0025 hit: `npm run check:comments` names nothing in a repo
    // Whetstone did not write, so the seeded check fails on every run.
    expect(file()?.contents).toContain("wst check run comment-density");
    expect(file()?.contents).not.toContain("npm run check");
  });

  it("sends the prose it evicts to the description, not to the commit body", () => {
    // The check tells you where the comment belongs instead, and it said the
    // commit body. A repo whose commits are one line then has nowhere to put it,
    // which is how this one ended up with a twenty-five line commit message.
    const contents = file()?.contents ?? "";

    expect(contents).toMatch(/pull request description/i);
    expect(contents).not.toMatch(/commit body/i);
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
