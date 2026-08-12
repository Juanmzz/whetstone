/**
 * Path/glob matching for triage and check selection.
 *
 * PURE. `node:path`'s `matchesGlob` is deterministic string matching — no I/O, no
 * ambient state — so it belongs in the core under exactly the rule that lets
 * `node:crypto` in (see `core/receipts/hash.ts` and `test/architecture.test.ts`:
 * the boundary is about EFFECTS, not built-ins). Using it is a recorded decision
 * (`.wst/lanes.yaml`, lane `triage`): no glob dependency is added.
 *
 * Two measured behaviours of `matchesGlob` that callers must know:
 *
 * 1. **`**` does not cross a dot-leading segment.** `matchesGlob(".wst/x.md", "**")`
 *    is FALSE. Any pattern covering `.wst/` or `.claude/` must spell the dotted
 *    segment out (`.wst/skills/**` works). A consequence worth stating plainly:
 *    **`"**"` is not a catch-all**, which is why triage's unmatched-file fallback
 *    is a constant in code rather than a final `**` rule in the config.
 *
 * 2. **A malformed pattern returns false; it does not throw.** So a typo'd glob is
 *    a silently DEAD rule. Nothing downstream can detect that, so the loader's job
 *    is to make rules few and reviewable, and this is the warning label.
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
