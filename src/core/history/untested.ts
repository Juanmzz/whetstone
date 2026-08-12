/**
 * Which strict-tier modules ARRIVED without a test. Measured over real commits.
 *
 * PURE. Git is the shell's problem: this takes a sequence of commits as data and
 * returns the modules that landed with nothing covering them.
 *
 * **What this deliberately does NOT measure.** An earlier version of this module
 * also reported implementation and test landing in the SAME commit, as a proxy for
 * "the test never got to fail". That was dropped, and the reason is worth keeping:
 * git cannot distinguish a test written first from one written afterwards and
 * committed first, so the proxy measured commit ceremony rather than discipline —
 * 35 of its 42 findings were that kind. Watching a test fail is where the value
 * is, and the evidence for it belongs in the commit body, where it can show the
 * test failed for the RIGHT reason. `[TD7]` asks for exactly that, and a separate
 * commit never proves it.
 *
 * What survives is the finding that is not ceremony: a module entered the strict
 * tier and nothing ever tested it. Seven of the forty-two, and each one actionable.
 */

import type { ChangedFile } from "../diff/parse.js";

export interface HistoryCommit {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly ChangedFile[];
}

export interface UntestedOptions {
  /**
   * Whether a path is one this can speak about: strict-tier, and a module that
   * could carry a colocated test at all.
   *
   * A PARAMETER rather than a glob list, so triage stays the one place that
   * decides what strict means — a second copy here would disagree with
   * `triage.yaml` the first time either changed. It also carries the filter
   * triage cannot express: `.claude/hooks/**` and the skills are strict and are
   * not TypeScript modules, so measuring them against a colocated test says
   * nothing.
   */
  readonly inScope: (path: string) => boolean;
  /** Module keys already carrying a test before the first commit in the range. */
  readonly testedAtBase: readonly string[];
}

export interface UntestedArrival {
  readonly sha: string;
  readonly subject: string;
  readonly file: string;
  readonly module: string;
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
 * goes, and reports the ones that ARRIVED before any test existed for them.
 *
 * Order is the whole measurement: replayed newest-first, a test written later
 * would excuse the module that preceded it.
 *
 * Only an ADDED file can be reported. Editing a module that never had a test is
 * a pre-existing coverage hole, not something this commit did — and reporting it
 * would fire again on every future edit to a type declaration like `ports.ts`,
 * which is the permanently-warning check `core/init/checks.ts` calls noise.
 */
export function findUntestedArrivals(
  commits: readonly HistoryCommit[],
  options: UntestedOptions,
): UntestedArrival[] {
  const tested = new Set<string>(options.testedAtBase);
  const arrivals: UntestedArrival[] = [];

  for (const commit of commits) {
    const scoped = commit.files.filter((file) => options.inScope(file.path));

    const testsHere = new Set(
      scoped.filter((file) => isTestPath(file.path)).map((file) => moduleKey(file.path)),
    );

    for (const file of scoped) {
      if (isTestPath(file.path) || file.status !== "added") continue;
      const key = moduleKey(file.path);
      if (tested.has(key) || testsHere.has(key)) continue;
      arrivals.push({
        sha: commit.sha,
        subject: commit.subject,
        file: file.path,
        module: key,
      });
    }

    // Applied AFTER the commit is judged. A test added here covers the commits
    // that follow; for the one it arrived in, `testsHere` already excused it.
    for (const key of testsHere) tested.add(key);
  }

  return arrivals;
}
