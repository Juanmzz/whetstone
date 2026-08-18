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
 * **`same-commit` was a violation and is not any more.** When this was written,
 * hard rule 4 read "RED first, in its own commit", so a test landing WITH its
 * implementation had never failed on its own. On 2026-08-14 the retro amended
 * [TD1]/[TD2] against `sig-e8dfefd0`: the repo owner had said three times that
 * separate RED and GREEN commits are unwanted, and the rule as written was
 * producing the thing it existed to prevent. One commit per coherent change,
 * with the red output quoted in the body, is the discipline now.
 *
 * Run unchanged over 74 real commits it reported 9 findings, every one of them a
 * correct commit under the current rule and none of them a defect. A check that
 * is red on the right answer gets routed around, and then it stops catching the
 * one thing it can still speak about: implementation that ARRIVES with no test.
 */

import type { ChangedFile } from "../diff/parse.js";

export interface HistoryCommit {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly ChangedFile[];
}

export interface RedFirstOptions {
  /**
   * Whether a path is one this rule can speak about: strict-tier, and a module
   * that could carry a colocated test at all.
   *
   * A PARAMETER rather than a glob list, so triage stays the one place that
   * decides what strict means — a second copy here would disagree with
   * `triage.yaml` the first time either changed. It also carries the second
   * filter, which triage cannot: `.claude/hooks/**` and the skills are strict and
   * have no colocated test, so measuring them against one says nothing.
   */
  readonly inScope: (path: string) => boolean;
  /** Module keys already carrying a test before the first commit in the range. */
  readonly testedAtBase: readonly string[];
}

/**
 * `no-test` — a module arrived with no test, in its commit or any before it.
 *
 * One kind, deliberately. `same-commit` used to be the other and is now the
 * expected shape; see the header.
 */
export type ViolationKind = "no-test";

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

/** The half of a violation that is just "where" — shared by both kinds. */
const where = (
  commit: HistoryCommit,
  file: ChangedFile,
  module: string,
): Omit<RedFirstViolation, "kind"> => ({
  sha: commit.sha,
  subject: commit.subject,
  file: file.path,
  module,
});

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
    const scoped = commit.files.filter((file) => options.inScope(file.path));

    // A deletion removes implementation rather than adding any, so it cannot owe
    // a test. Renames are excluded for the same reason a rename is not new
    // behaviour — the code arrived under its old path, where this already ran.
    const implementation = scoped.filter(
      (file) =>
        !isTestPath(file.path) && (file.status === "added" || file.status === "modified"),
    );

    const testsHere = new Set(
      scoped.filter((file) => isTestPath(file.path)).map((file) => moduleKey(file.path)),
    );

    for (const file of implementation) {
      const key = moduleKey(file.path);
      if (tested.has(key)) continue;

      // A test arriving in this same commit is the discipline, not a miss.
      if (testsHere.has(key)) continue;

      // `no-test` is reported only where the module ARRIVES. Editing a module
      // that never had a test is a coverage hole, not a statement about the
      // order of a test and the code it covers, and reporting it would fire on
      // every future edit to a type declaration — a check nothing can satisfy,
      // which is the permanently-warning check `core/init/checks.ts` calls noise.
      if (file.status === "added") {
        violations.push({ ...where(commit, file, key), kind: "no-test" });
      }
    }

    // Applied AFTER the commit is judged, never during. A test added here is
    // evidence for the commits that follow, not for the one it arrived in.
    for (const key of testsHere) tested.add(key);
  }

  return violations;
}
