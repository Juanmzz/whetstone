/**
 * Did the test precede the implementation? Measured over real commits.
 *
 * PURE. Git is the shell's problem: this takes a sequence of commits as data and
 * returns the places where strict-tier implementation landed without a test
 * having come first. `scripts/red-first.ts` is the adapter that fills it.
 *
 * **What "preceded" means here, and why it is not stricter.** A module counts as
 * tested from the moment ANY earlier commit touched its colocated `*.test.ts`, or
 * from the start if the test already existed before the range. That is weaker than
 * TDD — it cannot tell a test written first from a test written afterwards and
 * committed first — but it is the strongest claim git actually supports. A check
 * that inferred more than its evidence carries would be exactly the "measured, not
 * chosen" failure `[TD7]` warns about, and the first false positive is what
 * teaches people to route around it.
 *
 * The two violations are kept apart because they call for different things.
 * `same-commit` is a discipline miss: the test exists, it just did not go RED on
 * its own. `no-test` is a coverage hole. Collapsing them would report the
 * project's most common finding and its most serious one as the same event.
 */

import type { ChangedFile } from "../diff/parse.js";

export interface HistoryCommit {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly ChangedFile[];
}

export interface RedFirstOptions {
  /** Whether a path is strict-tier. Supplied by the caller so triage stays the
   *  one place that decides tiers — this module must not re-encode the globs. */
  readonly isStrict: (path: string) => boolean;
  /** Module keys already carrying a test before the first commit in the range. */
  readonly testedAtBase: readonly string[];
}

/**
 * `same-commit` — the test landed WITH the implementation, so it never failed.
 * `no-test` — no commit in or before the range touched the module's test at all.
 */
export type ViolationKind = "same-commit" | "no-test";

export interface RedFirstViolation {
  readonly sha: string;
  readonly subject: string;
  readonly file: string;
  readonly module: string;
  readonly kind: ViolationKind;
}

const TEST_SUFFIX = ".test.ts";

/**
 * Whether a path is a colocated test.
 *
 * The suffix is matched with its dot: `latest.ts` ends in `test.ts` and is a
 * module, not a test for one. Getting this wrong would silently mark such a
 * module as its own test and excuse every commit that touched it.
 */
export function isTestPath(path: string): boolean {
  return path.endsWith(TEST_SUFFIX);
}

/** The key a `.ts` module and its `.test.ts` share. */
export function moduleKey(path: string): string {
  return isTestPath(path)
    ? path.slice(0, -TEST_SUFFIX.length)
    : path.replace(/\.ts$/, "");
}

/**
 * Walks the range OLDEST FIRST, accumulating which modules have a test as it
 * goes. Order is the whole measurement: the same commits replayed newest-first
 * would let a test written later excuse the implementation that preceded it.
 */
export function findRedFirstViolations(
  commits: readonly HistoryCommit[],
  options: RedFirstOptions,
): RedFirstViolation[] {
  const tested = new Set<string>(options.testedAtBase);
  const violations: RedFirstViolation[] = [];

  for (const commit of commits) {
    const strict = commit.files.filter((file) => options.isStrict(file.path));

    // A deletion removes implementation rather than adding any, so it cannot owe
    // a test. Renames are excluded for the same reason a rename is not new
    // behaviour — the code arrived under its old path, where this already ran.
    const implementation = strict.filter(
      (file) =>
        !isTestPath(file.path) && (file.status === "added" || file.status === "modified"),
    );

    const testsHere = new Set(
      strict.filter((file) => isTestPath(file.path)).map((file) => moduleKey(file.path)),
    );

    for (const file of implementation) {
      const key = moduleKey(file.path);
      if (tested.has(key)) continue;
      violations.push({
        sha: commit.sha,
        subject: commit.subject,
        file: file.path,
        module: key,
        kind: testsHere.has(key) ? "same-commit" : "no-test",
      });
    }

    // Applied AFTER the commit is judged, never during. A test added here is
    // evidence for the commits that follow, not for the one it arrived in.
    for (const key of testsHere) tested.add(key);
  }

  return violations;
}
