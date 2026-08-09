/**
 * How deep `wst init` reads a repo — the policy half of the walk.
 *
 * PURE. The walking is I/O and lives in `src/commands/init.ts`; what counts as
 * "deep enough" is a decision, and decisions live here where a unit test can
 * reach them.
 *
 * ## Why depth is counted from the nearest manifest, not from the repo root
 *
 * A fixed depth from the root is a bound on the wrong thing. `src/a/b/c/d.ts` and
 * `apps/api/src/llm/__tests__/retry.test.ts` are the same distance into their own
 * package; only the second one is five levels from the root, and only because the
 * repo is a monorepo. Counting from the root therefore makes the walk's blindness
 * proportional to how many packages a repo has — the repos where seeing the code
 * matters most are the ones it sees least of.
 *
 * The concrete cost of getting this wrong is not a thinner file list. `init` reads
 * `hasTests` off that list, and `seedChecks` writes "no test files were found at
 * init" into the generated `test` check when it is false. On a monorepo with a
 * blocking test suite in CI that sentence is not a conservative default, it is a
 * false statement that DEGRADES a guarantee the project already enforces.
 *
 * So the budget restarts at every package manifest: a monorepo is a repo of repos,
 * and each of them gets the same depth a flat repo gets. `MAX_DEPTH` still bounds
 * the walk *within* a package, and `MAX_FILES` still bounds it globally — the two
 * halves of the cost the old constant was paying for on its own.
 */

/**
 * Deep enough to see `src/`**`/*.ts` and `.github/workflows/` from wherever the
 * enclosing package starts, shallow enough to stay instant.
 */
export const MAX_DEPTH = 4;

/** Global ceiling. The one bound a per-package budget cannot provide. */
export const MAX_FILES = 4000;

/** Directories never worth walking: huge, generated, or somebody else's code. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);

export function skipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

/**
 * The files that mean "a package starts here". Deliberately the manifests of the
 * toolchains `detectStack` already knows how to read: a marker the engine cannot
 * interpret is a marker it should not be spending walk budget on.
 */
const MANIFESTS: ReadonlySet<string> = new Set([
  "package.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
]);

/**
 * The depth to record a directory at, given the depth its parent walked it with
 * and the names of the FILES it contains — or `null` when the budget is spent and
 * the directory's contents must not be collected.
 *
 * File names only: a directory called `package.json` declares nothing.
 */
export function walkDepth(depth: number, fileNames: readonly string[]): number | null {
  const here = fileNames.some((name) => MANIFESTS.has(name)) ? 0 : depth;
  return here > MAX_DEPTH ? null : here;
}
