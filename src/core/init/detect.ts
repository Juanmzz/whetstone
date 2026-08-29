/**
 * Deterministic repo reading — Layer 1 (`wst init`).
 *
 * PURE. Every fact arrives as DATA (`RepoFacts`); the composition root does the
 * walking and reading. That is what makes "a repo with no tests seeds no test
 * check" a unit test instead of a fixture directory.
 *
 * It reads what a repo DECLARES about itself and nothing else — scripts, lockfile,
 * whether a test file exists. Why declared beats inferred: adr-0016.
 */

export interface PackageJson {
  readonly name?: unknown;
  readonly packageManager?: unknown;
  /** npm/yarn take an array; pnpm and yarn's older form take `{ packages: [] }`. */
  readonly workspaces?: unknown;
  readonly engines?: Readonly<Record<string, unknown>>;
  readonly scripts?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
}

/**
 * The facts a shell adapter must gather before `init` can decide anything. Kept
 * deliberately small: a bigger surface means a slower walk and more to mock.
 *
 * `commitSubjects` and `contributors` are no longer read by `detectStack` — they
 * are context for the judge in `buildProposalPrompt`, which is now the thing that
 * answers "what is this project" instead of a regex.
 */
export interface RepoFacts {
  /** Directory basename of the target repo. Used in generated titles. */
  readonly repoName: string;
  /** Repo-relative paths that exist. The shell caps depth and skips ignored dirs. */
  readonly files: readonly string[];
  /** Parsed `package.json`, or null when absent OR unparseable. */
  readonly packageJson: PackageJson | null;
  /** Recent commit subjects, newest first. Empty when there is no history. */
  readonly commitSubjects: readonly string[];
  /** Distinct commit authors, or null when unknown (no history, shallow clone). */
  readonly contributors: number | null;
}

export interface DetectedCommands {
  readonly test: string | null;
  readonly typecheck: string | null;
  readonly lint: string | null;
}

/** Everything the repo states about itself. Five fields, all of them read. */
export interface StackFacts {
  readonly packageManager: string | null;
  readonly commands: DetectedCommands;
  readonly hasTests: boolean;
  /**
   * Which detected commands REWRITE the tree. Read off the script body, not the
   * invocation: `npm run lint` says nothing, `eslint --fix` says everything.
   */
  readonly mutating: readonly (keyof DetectedCommands)[];
  /** What was read and from which file. A plan a human cannot audit is a guess. */
  readonly evidence: readonly string[];
  /**
   * Answers the repo states about ITSELF, for pre-filling the interview.
   *
   * adr-0016 stopped `init` inferring; it never stopped it reading. A
   * `workspaces` array and an `engines` field are declarations, not a table
   * guessing a language from file extensions. Empty and null mean the repo said
   * nothing, which is still a blank for a human to fill.
   */
  readonly declared: DeclaredAnswers;
}

export interface DeclaredAnswers {
  /** Source roots, as globs. Read off `workspaces` and confirmed against the tree. */
  readonly sourceGlobs: readonly string[];
  /** Language and runtime, from the files that name them. Null when nothing does. */
  readonly stack: string | null;
}

/**
 * `npm init` writes this. It exits 1 by design, so a `test` check built on it
 * blocks every change in a repo that has no tests — the exact failure mode that
 * gets a gate uninstalled on day one.
 */
const NPM_PLACEHOLDER_TEST = /^\s*echo\s+["']?Error: no test specified/i;

/**
 * Flags that make a command rewrite what it is judging.
 *
 * A check running one of these does not measure anything: it reports on a file
 * that no longer exists in the form the author wrote it, and it hides the finding
 * it was meant to surface. `-w` is included because it means `--write` in some
 * tools and `--watch` in others, and a watcher inside a gate never returns —
 * both are wrong here, so neither needs telling apart.
 *
 * The negative lookahead matters: `--fix-dry-run` reports without writing, and
 * `--check` is the read-only half of `--write`.
 */
const MUTATING_FLAG = /(?:^|\s)(?:--fix(?!-dry-run)|--write|-w|-u|--updateSnapshot)(?=\s|$)/;

const LOCKFILES: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

function normalise(path: string): string {
  let out = path;
  while (out.startsWith("./")) out = out.slice(2);
  while (out.startsWith("/")) out = out.slice(1);
  return out;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
  if (pkg === null) return false;
  return (
    Object.hasOwn(pkg.dependencies ?? {}, name) || Object.hasOwn(pkg.devDependencies ?? {}, name)
  );
}

/** First script name that exists AND is not a known placeholder. */
function script(pkg: PackageJson | null, names: readonly string[]): string | null {
  const scripts = pkg?.scripts ?? {};
  for (const name of names) {
    const body = str(scripts[name]);
    if (body === null) continue;
    if (name === "test" && NPM_PLACEHOLDER_TEST.test(body)) continue;
    return name;
  }
  return null;
}

export function detectStack(facts: RepoFacts): StackFacts {
  const files = facts.files.map(normalise);
  const has = (p: string): boolean => files.includes(p);
  const evidence: string[] = [];
  const note = (what: string, from: string): void => {
    evidence.push(`${what} (from ${from})`);
  };

  // ── package manager ───────────────────────────────────────────────────────
  // Corepack's `packageManager` field is a declaration; a lockfile is an
  // artefact, and artefacts go stale (a repo that migrated to pnpm often still
  // carries package-lock.json). The declaration wins.
  let packageManager: string | null = null;
  const declared = str(facts.packageJson?.packageManager);
  if (declared !== null) {
    packageManager = declared.split("@")[0] ?? null;
    note(`package manager: ${String(packageManager)}`, "package.json packageManager field");
  } else {
    for (const [lock, pm] of LOCKFILES) {
      if (has(lock)) {
        packageManager = pm;
        note(`package manager: ${pm}`, lock);
        break;
      }
    }
    if (packageManager === null && facts.packageJson !== null) {
      packageManager = "npm";
      note("package manager: npm (no lockfile: assumed)", "package.json");
    }
  }
  // Not a guess at a language: `go.mod` and `Cargo.toml` each name their own
  // tool, and the evidence line says which file said so.
  if (packageManager === null && has("go.mod")) packageManager = "go";
  if (packageManager === null && has("Cargo.toml")) packageManager = "cargo";

  // ── commands ──────────────────────────────────────────────────────────────
  const commands = detectCommands(facts.packageJson, packageManager, has, note);

  const hasTests = files.some(
    (f) =>
      /(^|\/)(test|tests|__tests__|spec)\//.test(f) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) ||
      /(^|\/)test_[^/]+\.py$/.test(f) ||
      /_test\.go$/.test(f),
  );
  if (hasTests) note("tests: present", "test file paths");

  const mutating = mutatingCommands(facts.packageJson, note);

  return {
    packageManager,
    commands,
    hasTests,
    mutating,
    evidence,
    declared: declaredAnswers(facts, files, note),
  };
}

/**
 * Which detected commands rewrite the tree, read off the SCRIPT BODY.
 *
 * `commands` holds the invocation (`npm run lint`), which says nothing about
 * what runs. The body is where `--fix` is visible, and seeing it is the whole
 * fix: a repo's own script can be wrong about what belongs in a gate, and
 * nothing in the target repo necessarily warns about it — in the one real run
 * this came from, the host's `CLAUDE.md` prescribed the mutating lint as a
 * verification step rather than warning about it.
 */
function mutatingCommands(
  pkg: PackageJson | null,
  note: (what: string, from: string) => void,
): readonly (keyof DetectedCommands)[] {
  const scripts = pkg?.scripts ?? {};
  const found: (keyof DetectedCommands)[] = [];
  for (const [key, names] of [
    ["test", ["test"]],
    ["typecheck", ["typecheck", "type-check", "tsc"]],
    ["lint", ["lint"]],
  ] as const) {
    for (const name of names) {
      const body = str(scripts[name]);
      if (body === null || !MUTATING_FLAG.test(body)) continue;
      found.push(key);
      note(`${key}: rewrites the tree (${body.trim()})`, "package.json scripts");
      break;
    }
  }
  return found;
}

function detectCommands(
  pkg: PackageJson | null,
  pm: string | null,
  has: (p: string) => boolean,
  note: (what: string, from: string) => void,
): DetectedCommands {
  // Toolchains where the command ships with the toolchain itself, so its
  // existence is guaranteed by the manifest we already saw.
  if (has("go.mod")) {
    note("commands: go toolchain", "go.mod");
    return { test: "go test ./...", typecheck: "go build ./...", lint: "go vet ./..." };
  }
  if (has("Cargo.toml")) {
    note("commands: cargo", "Cargo.toml");
    // No clippy: it is a separate rustup component and may not be installed.
    return { test: "cargo test", typecheck: "cargo check", lint: null };
  }

  if (pkg === null) {
    // Python and everything else: the runner is a project choice we cannot read
    // off disk. `pytest` is a good guess and a good guess is not good enough —
    // it produces an `errored` gate, not a failing one.
    return { test: null, typecheck: null, lint: null };
  }

  const runner = pm ?? "npm";
  const run = (name: string): string => `${runner} run ${name}`;

  const testScript = script(pkg, ["test"]);
  const typeScript = script(pkg, ["typecheck", "type-check", "tsc"]);
  const lintScript = script(pkg, ["lint"]);

  if (testScript !== null) note(`test: ${run(testScript)}`, "package.json scripts");
  if (typeScript !== null) note(`typecheck: ${run(typeScript)}`, "package.json scripts");
  if (lintScript !== null) note(`lint: ${run(lintScript)}`, "package.json scripts");

  let typecheck: string | null = typeScript === null ? null : run(typeScript);
  if (typecheck === null && has("tsconfig.json") && hasDep(pkg, "typescript")) {
    // `npx --no-install` resolves node_modules/.bin under every package manager
    // and REFUSES to silently fetch from the network — so if the dep is somehow
    // missing the check fails loudly instead of quietly installing a compiler.
    typecheck = "npx --no-install tsc --noEmit";
    note("typecheck: local tsc", "tsconfig.json + typescript dependency");
  }

  return {
    test: testScript === null ? null : run(testScript),
    typecheck,
    lint: lintScript === null ? null : run(lintScript),
  };
}

/** `["apps/*"]`, or `{ packages: ["apps/*"] }`. Anything else is not a declaration. */
function workspaceGlobs(pkg: PackageJson | null): readonly string[] {
  const raw = pkg?.workspaces;
  const list = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === "object" && Array.isArray((raw as { packages?: unknown }).packages)
      ? ((raw as { packages: unknown[] }).packages)
      : [];
  return list.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/**
 * A workspace pattern as a SOURCE glob.
 *
 * `apps/*` says where the packages are and nothing about where the code sits
 * inside one. So the tree is asked: if any member has a `src/`, the glob narrows
 * to it, and otherwise it stays wide. That is reading, not a convention applied
 * blind.
 */
function sourceGlobFor(pattern: string, files: readonly string[]): string {
  const prefix = `${pattern.replace(/\/?\*+$/, "")}/`;
  const inSrc = files.some((f) => {
    if (!f.startsWith(prefix.split("*")[0] ?? prefix)) return false;
    const rest = f.slice((prefix.split("*")[0] ?? prefix).length);
    return /^[^/]+\/src\//.test(rest);
  });
  return `${pattern.replace(/\/$/, "")}/${inSrc ? "src/**" : "**"}`;
}

/** Files that NAME a language, as opposed to files written in one. */
const DECLARES_LANGUAGE: readonly (readonly [RegExp, string])[] = [
  [/(^|\/)tsconfig\.json$/, "TypeScript"],
  [/(^|\/)Cargo\.toml$/, "Rust"],
  [/(^|\/)go\.mod$/, "Go"],
  [/(^|\/)pyproject\.toml$/, "Python"],
  [/(^|\/)Gemfile$/, "Ruby"],
];

function declaredAnswers(
  facts: RepoFacts,
  files: readonly string[],
  note: (what: string, from: string) => void,
): DeclaredAnswers {
  const patterns = workspaceGlobs(facts.packageJson);
  const sourceGlobs = patterns.map((p) => sourceGlobFor(p, files));
  if (sourceGlobs.length > 0) {
    note(`source roots: ${sourceGlobs.join(", ")}`, "package.json workspaces");
  }

  const languages: string[] = [];
  for (const [pattern, name] of DECLARES_LANGUAGE) {
    const at = files.find((f) => pattern.test(f));
    if (at === undefined || languages.includes(name)) continue;
    languages.push(name);
    note(`language: ${name}`, at);
  }

  const node = str(facts.packageJson?.engines?.["node"]);
  if (node !== null) note(`runtime: Node ${node}`, "package.json engines");

  const parts = [...languages];
  if (node !== null) parts.push(`Node ${node}`);

  return { sourceGlobs, stack: parts.length === 0 ? null : parts.join(", ") };
}
