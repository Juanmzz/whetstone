/**
 * Deterministic repo detection — Layer 1 (`wst init`), the "infer, don't ask" half.
 *
 * PURE. Every fact arrives as DATA (`RepoFacts`); the composition root does the
 * walking and reading. That is what makes "a repo with no tests seeds no test
 * check" a unit test instead of a fixture directory.
 *
 * The governing rule, from `docs/woz/init.md`: **whatever the engine can KNOW it
 * must not ask.** The 15-minute ceiling in the WoZ procedure is not a stylistic
 * preference — every question spent on something the repo already answered is a
 * question the human stops answering carefully.
 *
 * The second rule, and the sharper one: **never infer a command that might not
 * exist.** A seeded check whose `command` cannot run does not fail the build in a
 * legible way — it makes the gate `errored` on every single run, which reads as
 * "the gate is broken" and gets the gate switched off. Silence is strictly better
 * than a guess here, so every command below is either read from the project's own
 * scripts or is a command the detected toolchain guarantees.
 */

export interface PackageJson {
  readonly name?: unknown;
  readonly packageManager?: unknown;
  readonly scripts?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
}

/**
 * The facts a shell adapter must gather before `init` can decide anything. Kept
 * deliberately small: a bigger surface means a slower walk and more to mock.
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

export type Greenness = "greenfield" | "brownfield";
export type CommitStyle = "conventional" | "unknown";

export interface DetectedCommands {
  readonly test: string | null;
  readonly typecheck: string | null;
  readonly lint: string | null;
}

export interface StackFacts {
  readonly greenness: Greenness;
  readonly language: string | null;
  readonly packageManager: string | null;
  readonly commands: DetectedCommands;
  readonly ci: string | null;
  /** Source directories found, as globs (`src/**`). Empty when none are recognisable. */
  readonly sourceGlobs: readonly string[];
  /** Globs matching this language's source files, for a check's `include`. */
  readonly sourceFileGlobs: readonly string[];
  readonly hasTests: boolean;
  readonly commitStyle: CommitStyle;
  /** Solo work: `doc-locations` runs at reduced scope (WoZ init, step 3 calibration). */
  readonly solo: boolean;
  /** What was inferred and from which file. A plan a human cannot audit is a guess. */
  readonly evidence: readonly string[];
}

/** Extensions that mean "there is code here". Config and prose deliberately excluded. */
const SOURCE_EXT = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".kt",
  ".php",
  ".cs",
  ".swift",
  ".scala",
  ".ex",
  ".exs",
];

const SOURCE_DIRS = ["src", "lib", "app", "pkg", "internal", "cmd"];

/**
 * `npm init` writes this. It exits 1 by design, so a `test` check built on it
 * blocks every change in a repo that has no tests — the exact failure mode that
 * gets a gate uninstalled on day one.
 */
const NPM_PLACEHOLDER_TEST = /^\s*echo\s+["']?Error: no test specified/i;

const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?: .+/;

const LOCKFILES: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

const CI_MARKERS: readonly (readonly [string, string])[] = [
  [".github/workflows/", "GitHub Actions"],
  [".gitlab-ci.yml", "GitLab CI"],
  [".circleci/config.yml", "CircleCI"],
  ["Jenkinsfile", "Jenkins"],
  [".buildkite/", "Buildkite"],
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
  const under = (prefix: string): boolean => files.some((f) => f.startsWith(prefix));
  const anyExt = (ext: string): boolean => files.some((f) => f.endsWith(ext));
  const evidence: string[] = [];
  const note = (what: string, from: string): void => {
    evidence.push(`${what} (from ${from})`);
  };

  // ── language ──────────────────────────────────────────────────────────────
  let language: string | null = null;
  if (has("tsconfig.json") || anyExt(".ts") || anyExt(".tsx")) {
    language = "TypeScript";
    note("language: TypeScript", has("tsconfig.json") ? "tsconfig.json" : "*.ts files");
  } else if (has("go.mod")) {
    language = "Go";
    note("language: Go", "go.mod");
  } else if (has("Cargo.toml")) {
    language = "Rust";
    note("language: Rust", "Cargo.toml");
  } else if (has("pyproject.toml") || has("requirements.txt") || anyExt(".py")) {
    language = "Python";
    note("language: Python", has("pyproject.toml") ? "pyproject.toml" : "*.py files");
  } else if (facts.packageJson !== null || anyExt(".js") || anyExt(".mjs")) {
    language = "JavaScript";
    note("language: JavaScript", "package.json");
  }

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
      note("package manager: npm (no lockfile — assumed)", "package.json");
    }
  }
  if (packageManager === null && language === "Go") packageManager = "go";
  if (packageManager === null && language === "Rust") packageManager = "cargo";

  // ── commands ──────────────────────────────────────────────────────────────
  const commands = detectCommands(facts.packageJson, language, packageManager, has, note);

  // ── layout ────────────────────────────────────────────────────────────────
  const sourceGlobs = SOURCE_DIRS.filter((d) => under(`${d}/`)).map((d) => `${d}/**`);
  if (sourceGlobs.length > 0) note(`source dirs: ${sourceGlobs.join(", ")}`, "directory listing");

  const hasTests = files.some(
    (f) =>
      /(^|\/)(test|tests|__tests__|spec)\//.test(f) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) ||
      /(^|\/)test_[^/]+\.py$/.test(f) ||
      /_test\.go$/.test(f),
  );
  if (hasTests) note("tests: present", "test file paths");

  let ci: string | null = null;
  for (const [marker, name] of CI_MARKERS) {
    if (marker.endsWith("/") ? under(marker) : has(marker)) {
      ci = name;
      note(`CI: ${name}`, marker);
      break;
    }
  }

  // ── commit style ──────────────────────────────────────────────────────────
  // Three commits is the floor: below that a "style" is a coincidence, and
  // asserting a convention the project does not hold is worse than asking.
  let commitStyle: CommitStyle = "unknown";
  if (facts.commitSubjects.length >= 3) {
    const hits = facts.commitSubjects.filter((s) => CONVENTIONAL.test(s)).length;
    if (hits / facts.commitSubjects.length >= 0.6) {
      commitStyle = "conventional";
      note("commit style: Conventional Commits", `${hits}/${facts.commitSubjects.length} commits`);
    }
  }

  // ── greenness ─────────────────────────────────────────────────────────────
  const hasCode = files.some((f) => SOURCE_EXT.some((e) => f.endsWith(e)));
  const greenness: Greenness = hasCode || facts.packageJson !== null ? "brownfield" : "greenfield";

  return {
    greenness,
    language,
    packageManager,
    commands,
    ci,
    sourceGlobs,
    sourceFileGlobs: sourceFileGlobs(language, sourceGlobs),
    hasTests,
    commitStyle,
    solo: facts.contributors !== null && facts.contributors <= 1,
    evidence,
  };
}

function detectCommands(
  pkg: PackageJson | null,
  language: string | null,
  pm: string | null,
  has: (p: string) => boolean,
  note: (what: string, from: string) => void,
): DetectedCommands {
  // Toolchains where the command ships with the toolchain itself, so its
  // existence is guaranteed by the marker file we already saw.
  if (language === "Go") {
    note("commands: go toolchain", "go.mod");
    return { test: "go test ./...", typecheck: "go build ./...", lint: "go vet ./..." };
  }
  if (language === "Rust") {
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

/**
 * Globs for a check's `include`. Scoped to the detected source dirs when there
 * are any: a bare `**` /*.ts also matches `node_modules` fixtures and generated
 * output in repos that commit them.
 */
function sourceFileGlobs(language: string | null, sourceGlobs: readonly string[]): string[] {
  const exts: Record<string, readonly string[]> = {
    TypeScript: ["ts", "tsx"],
    JavaScript: ["js", "jsx", "mjs", "cjs"],
    Python: ["py"],
    Go: ["go"],
    Rust: ["rs"],
  };
  const list = language === null ? undefined : exts[language];
  if (list === undefined) return [];

  const roots = sourceGlobs.map((g) => g.replace(/\/\*\*$/, ""));
  if (roots.length === 0) return list.map((e) => `**/*.${e}`);
  return roots.flatMap((root) => list.map((e) => `${root}/**/*.${e}`));
}
