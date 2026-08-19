/**
 * How a leased worktree differs from the tree it was cut from.
 *
 * PURE. Paths in, gaps out.
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
