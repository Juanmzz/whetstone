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
  readonly description?: unknown;
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
  /**
   * Directories whose NAME says a bug there is expensive, as `glob : reason`
   * lines. Offered UNTICKED: which of them may not break is a human's judgement,
   * and this only spares them the recall.
   */
  readonly strictCandidates: readonly string[];
  /** `description` from package.json. A declaration, so adr-0016 allows it. */
  readonly purpose: string | null;
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
 * `apps/*` says where the packages are and nothing about where code sits inside
 * one, so the tree is asked. The pattern becomes a regex to ask with, because
 * npm accepts a literal path, a star, a globstar and any depth of them, and a
 * reading that only understood `apps/*` narrowed the wrong ones.
 */
function sourceGlobFor(pattern: string, files: readonly string[]): string {
  const base = pattern.replace(/\/+$/, "");
  const asRegex = base
    .split("/")
    .map((part) =>
      part
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]+")
        .replace(/\u0000/g, ".+"),
    )
    .join("/");
  const hasSrc = new RegExp(`^${asRegex}/src/`);
  return `${base}/${files.some((f) => hasSrc.test(f)) ? "src/**" : "**"}`;
}

/**
 * Directory names that say what a bug there would cost, and the words for it.
 *
 * The strict-paths question arrives blank with a billing example that exists in
 * no real repo, and it is the one that asks for the most memory. Its own help
 * says which part of the code is dangerous is a human judgement. It is, and
 * proposing candidates does not take that judgement: they arrive UNTICKED.
 */
const DANGEROUS: readonly (readonly [RegExp, string])[] = [
  [/^(auth|authn|authentication|login|session|sessions|oauth)$/i, "authentication and sessions"],
  [/^(secret|secrets|token|tokens|credential|credentials|keys|crypto)$/i, "secrets and credentials"],
  [/^(billing|payment|payments|invoice|invoices|checkout|pricing|ledger)$/i, "moves money"],
  [/^(migration|migrations|schema)$/i, "changes stored data"],
  [/^(permission|permissions|acl|allowlist|policy|policies|roles)$/i, "decides who may do what"],
];

/** Enough to read at a glance. A wall of rows is the same as no offer at all. */
const MAX_CANDIDATES = 8;

function strictCandidatesIn(files: readonly string[]): string[] {
  const found = new Map<string, string>();
  for (const file of files) {
    const parts = file.split("/");
    // Directories only, and not too deep to be a component of this project.
    for (const [depth, part] of parts.slice(0, -1).entries()) {
      if (depth > 3) break;
      const matched = DANGEROUS.find(([pattern]) => pattern.test(part));
      if (matched === undefined) continue;
      const dir = parts.slice(0, depth + 1).join("/");
      if (!found.has(dir)) found.set(dir, matched[1]);
    }
  }
  return [...found].slice(0, MAX_CANDIDATES).map(([dir, why]) => `${dir}/** : ${why}`);
}

/** Files that NAME a language, as opposed to files written in one. */
const DECLARES_LANGUAGE: readonly (readonly [RegExp, string])[] = [
  [/(^|\/)tsconfig\.json$/, "TypeScript"],
  [/(^|\/)Cargo\.toml$/, "Rust"],
  [/(^|\/)go\.mod$/, "Go"],
  [/(^|\/)pyproject\.toml$/, "Python"],
  [/(^|\/)Gemfile$/, "Ruby"],
];

/** What each of those languages is written in, for the count that orders them. */
const WRITTEN_IN: Readonly<Record<string, readonly string[]>> = {
  TypeScript: [".ts", ".tsx"],
  Rust: [".rs"],
  Go: [".go"],
  Python: [".py"],
  Ruby: [".rb"],
};

function fileCounts(files: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [name, extensions] of Object.entries(WRITTEN_IN)) {
    counts.set(name, files.filter((f) => extensions.some((e) => f.endsWith(e))).length);
  }
  return counts;
}

/**
 * The languages of this repo, most of it first.
 *
 * TWO readings crossed, because each alone gets a real repo wrong. A manifest
 * declares intent and a count measures reality: sift-app was called `Rust` off
 * `src-tauri/Cargo.toml` with 206 TypeScript files against 8 Rust ones, and the
 * counting heuristic that would have got it right had been dropped for the
 * declaration without ever comparing the two.
 *
 * A declared language stays declared whatever the count says, since a fresh
 * `cargo init` has a manifest and no code. An undeclared one is added only when
 * the tree holds MORE of it than of anything declared, which is the case a split
 * `tsconfig.app.json` produces and a Rust repo with three build scripts does not.
 */
function languagesIn(
  files: readonly string[],
  near: readonly string[],
  note: (what: string, from: string) => void,
): string[] {
  const counts = fileCounts(files);
  const found: { name: string; count: number; from: string }[] = [];

  for (const [pattern, name] of DECLARES_LANGUAGE) {
    const at = near.find((f) => pattern.test(f));
    if (at === undefined || found.some((l) => l.name === name)) continue;
    found.push({ name, count: counts.get(name) ?? 0, from: at });
  }

  const declaredTop = Math.max(0, ...found.map((l) => l.count));
  for (const [name, count] of counts) {
    if (count > declaredTop && !found.some((l) => l.name === name)) {
      found.push({ name, count, from: `${String(count)} files` });
    }
  }

  found.sort((a, b) => b.count - a.count);
  for (const l of found) note(`language: ${l.name} (${String(l.count)} files)`, l.from);
  return found.map((l) => l.name);
}

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

  // DEPTH, not a list of directory names. A manifest at the root or one level
  // down describes the project: `src-tauri/Cargo.toml` is where a Tauri app
  // declares its Rust half. Deeper than that it describes something inside the
  // project, and `examples/demo/pyproject.toml` made a TypeScript repo Python.
  const near = files.filter((f) => f.split("/").length <= 2);
  const languages = languagesIn(files, near, note);

  const node = str(facts.packageJson?.engines?.["node"]);
  if (node !== null) note(`runtime: Node ${node}`, "package.json engines");

  const parts = [...languages];
  if (node !== null) parts.push(`Node ${node}`);

  const purpose = str(facts.packageJson?.description);
  if (purpose !== null) note("purpose: declared", "package.json description");

  return {
    sourceGlobs,
    stack: parts.length === 0 ? null : parts.join(", "),
    strictCandidates: strictCandidatesIn(files),
    purpose,
  };
}
