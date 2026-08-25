/**
 * What to `git add` after `init`. PURE.
 *
 * The line was hardcoded, so it named `.claude` (which init stopped writing)
 * and omitted `GEMINI.md` (which it started writing). A stranger's first
 * command after `init` has to be true.
 */

import { DEFINITION_DIR } from "../paths.js";

interface StageablePlan {
  readonly files: readonly { readonly path: string }[];
  readonly copies: readonly { readonly to: string }[];
}

/** Top-level paths covering everything the plan writes, definition dir first. */
export function stagePaths(plan: StageablePlan): readonly string[] {
  const tops = new Set<string>();
  const written = [...plan.files.map((f) => f.path), ...plan.copies.map((c) => c.to)];
  for (const path of written) {
    const top = path.split("/")[0];
    if (top !== undefined && top !== "") tops.add(top);
  }

  const rest = [...tops].filter((p) => p !== DEFINITION_DIR).sort();
  return tops.has(DEFINITION_DIR) ? [DEFINITION_DIR, ...rest] : rest;
}
