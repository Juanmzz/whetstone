/**
 * Path/glob matching for triage and check selection.
 */

import { matchesGlob } from "node:path";

/**
 * Strips a leading `./`, repeatedly. `git diff --name-status` emits clean
 * repo-relative paths, but a path assembled anywhere else easily grows the
 * prefix, and `matchesGlob("./src/a.ts", "src/**")` is false — a rule that
 * silently stops matching is the worst failure mode a triage engine has.
 */
function normalise(path: string): string {
  let out = path;
  while (out.startsWith("./")) out = out.slice(2);
  while (out.startsWith("/")) out = out.slice(1);
  return out;
}

export function matchesPathGlob(path: string, glob: string): boolean {
  return matchesGlob(normalise(path), glob);
}

/** True when ANY pattern matches. An empty list matches NOTHING, never everything. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesPathGlob(path, glob));
}
