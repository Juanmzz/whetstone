/**
 * How a leased worktree differs from the tree it was cut from.
 *
 * PURE. Paths in, gaps out.
 *
 * A worktree contains what git tracks and nothing else. Everything ignored stays
 * behind, and `prepare` links one directory — the root `node_modules` — which is
 * a good default and not the whole story. Nothing reported the remainder, so the
 * difference surfaced later as a failure that looked like the worker's fault.
 *
 * Two shapes of it, both observed in one day of real use:
 *
 * - **Nested dependencies.** npm hoists most packages to the root but a workspace
 *   keeps its own. The worktree has neither, so a BLOCKING typecheck fails with
 *   `Cannot find module` in a file the worker never opened. Someone symlinked them
 *   by hand to get moving.
 * - **Absent environment.** `.env` is ignored, so it does not travel. Tests that
 *   self-skip without a key then PASS in the worktree and FAIL for whoever pulls
 *   the branch. A green that means "skipped" is the worst kind.
 *
 * WHAT THIS DOES NOT DO: fix either. Copying a `.env` into a worktree moves a
 * secret somewhere its owner did not put it, and linking every nested directory
 * guesses at a package manager's layout — the inference adr-0016 took out of
 * `init`. Naming the gap costs nothing and turns a mystery into a decision.
 */

export type GapKind =
  /** Dependency directories the root link does not reach. */
  | "nested-dependencies"
  /** Ignored configuration that a worktree never receives. */
  | "absent-environment";

export interface EnvironmentGap {
  readonly kind: GapKind;
  readonly paths: readonly string[];
  /** What goes wrong because of it, in the terms the reader will meet it in. */
  readonly why: string;
}

export interface WorktreeInput {
  /** Ignored or untracked paths in the source tree, repo-relative. */
  readonly untracked: readonly string[];
  /** What `prepare` links into the worktree, repo-relative. */
  readonly linked: readonly string[];
}

const DEPENDENCY_DIR = /(^|\/)node_modules$/;
const ENV_FILE = /(^|\/)\.env(\.|$)/;

export function environmentGaps(input: WorktreeInput): readonly EnvironmentGap[] {
  const linked = new Set(input.linked);
  const gaps: EnvironmentGap[] = [];

  const nested = input.untracked.filter((p) => DEPENDENCY_DIR.test(p) && !linked.has(p));
  if (nested.length > 0) {
    gaps.push({
      kind: "nested-dependencies",
      paths: nested,
      why:
        "the root `node_modules` is linked and these are not, so a check that resolves " +
        "imports fails on a file the work never touched. Link them or install in the worktree.",
    });
  }

  const env = input.untracked.filter((p) => ENV_FILE.test(p));
  if (env.length > 0) {
    gaps.push({
      kind: "absent-environment",
      paths: env,
      why:
        "ignored, so they do not travel to a worktree. A test that skips itself without a " +
        "key will PASS here and fail for whoever pulls the branch — read a green with that " +
        "in mind, or copy what this work actually needs.",
    });
  }

  return gaps;
}
