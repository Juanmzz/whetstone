/**
 * The name of the definition directory, and its ONLY owner (ADR-0012).
 *
 * PURE, and deliberately the smallest module in the core: everything imports it,
 * so anything else living here would be imported everywhere too.
 *
 * **This is a single source of truth, NOT a configuration option.** ADR-0012
 * rejects configurability twice over: `wst.yaml` lives inside the directory it
 * would name, and a user-settable value would have to be interpolated into the
 * ~108 sites of generated prose, which is a rewrite of the emitter to buy
 * flexibility nobody asked for. The value is fixed in code. What the constant buys
 * is that changing it is a one-line change instead of a 225-site find-and-replace
 * that drifts the first time someone touches one of them.
 *
 * It is used for TWO things, and the second is the one that is easy to forget:
 *
 * 1. Path construction — `join(repoRoot, DEFINITION_DIR)`.
 * 2. Interpolation into prose `wst init` GENERATES and writes into a target repo.
 *    Only 9 of the original 225 occurrences were paths; the rest were sentences.
 *
 * `test/definition-dir.test.ts` enforces the ownership by parsing `src/` and
 * refusing any string literal that spells the name out.
 */

/** The directory Whetstone writes into a repo. Relative to the repo root. */
export const DEFINITION_DIR = ".sdd";

/**
 * The same name, escaped for interpolation into a `RegExp` source.
 *
 * Here rather than at each call site because the leading dot is the whole hazard:
 * an unescaped `.sdd` matches `xsdd` too, and a path guard that quietly matches
 * more than it says is worse than one that matches nothing.
 */
export const DEFINITION_DIR_PATTERN = DEFINITION_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
