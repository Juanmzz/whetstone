/**
 * What `init` would destroy. PURE.
 *
 * `init` writes files into somebody else's repository. Until this module existed the
 * only guard was on `.wst/` itself (`commands/init.ts`), so a repo that had never
 * seen Whetstone but did have a hand-written `AGENTS.md`, a `CLAUDE.md` and a
 * populated `.claude/settings.json` lost all three, silently, with no backup and no
 * mention in the output. The writer is `mkdir -p` + `writeFile`, unconditional.
 *
 * That is the worst shape a destructive bug can take: it fires on the FIRST command
 * a new user runs, on the repo they were evaluating the tool with, and the files it
 * takes are exactly the ones a careful team hand-maintains.
 *
 * The fs check belongs to the caller. This decides what a collision MEANS.
 */

import { DEFINITION_DIR, DEFINITION_DIR_PATTERN } from "../paths.js";
import type { CopyRequest, GeneratedFile } from "./artifact.js";

/** The part of an `InitPlan` that can collide. Structural, so tests need not build a whole plan. */
export interface Collidable {
  readonly files: readonly GeneratedFile[];
  readonly copies: readonly CopyRequest[];
}

export interface Collision {
  readonly path: string;
  /** What losing this file costs, in the human's terms. Never empty. */
  readonly stake: string;
}

/**
 * Why each known path matters, in the words someone deciding whether to pass
 * `--force` actually needs. Uneven on purpose: an empty `signals.jsonl` coming back
 * empty is not the same event as a hand-written `CLAUDE.md` disappearing.
 */
/** Anchored at a subpath of the definition directory. Most specific first. */
const under = (subpath: string): RegExp =>
  new RegExp(`^${DEFINITION_DIR_PATTERN}/${subpath}`);

const STAKES: readonly (readonly [RegExp, string])[] = [
  [
    /^CLAUDE\.md$/,
    "replaced by a ONE LINE pointer to AGENTS.md. Anything written here is not merged, it is gone",
  ],
  [
    /^AGENTS\.md$/,
    `replaced by a generated artifact rendered from ${DEFINITION_DIR}/. Hand-written guidance here is not merged`,
  ],
  [
    /^\.claude\/settings\.json$/,
    "replaced wholesale with a file containing only Whetstone's hook. Existing permissions, env, statusLine and other hooks are NOT merged",
  ],
  [/^\.claude\/hooks\//, "an existing hook of the same name is replaced"],
  [under("memory/decisions/"), "an architecture decision record. This is the record of WHY, and nothing else holds it"],
  [under("memory/"), "recorded memory: signals, retro history, patterns"],
  [under("checks/"), "a check definition this project already relies on"],
  [under("skills/"), "a skill this project may have amended since it was installed"],
  [under(""), "part of the definition layer, which is the source of truth for this project's standards"],
];

const GENERIC = "an existing file that init writes. Its current contents are not preserved";

function stakeFor(path: string): string {
  for (const [pattern, stake] of STAKES) {
    if (pattern.test(path)) return stake;
  }
  return GENERIC;
}

/**
 * Every planned path that already exists, sorted, deduplicated.
 *
 * COPIES are included, not just generated files: a copy overwrites just as hard, and
 * guarding only `files` would leave the whole skills payload unguarded.
 *
 * `existing` is whatever the caller found on disk. Passing paths the plan does not
 * write is harmless — they are simply not collisions.
 */
export function collisionsIn(
  plan: Collidable,
  existing: Iterable<string>,
): readonly Collision[] {
  const onDisk = new Set(existing);
  const planned = new Set<string>([
    ...plan.files.map((file) => file.path),
    ...plan.copies.map((copy) => copy.to),
  ]);

  return [...planned]
    .filter((path) => onDisk.has(path))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => ({ path, stake: stakeFor(path) }));
}

/**
 * The refusal, rendered.
 *
 * Kept here rather than in the command so the wording is unit-testable — the same
 * reason `init`'s interview questions live in the core. A destructive-action message
 * that nothing asserts on is a message that drifts into uselessness.
 */
export function renderCollisions(collisions: readonly Collision[]): string {
  const lines = [
    `refusing to overwrite ${String(collisions.length)} existing file(s):`,
    "",
    ...collisions.flatMap((c) => [`  ${c.path}`, `      ${c.stake}`]),
    "",
    "  Nothing has been written. Commit or move these files, or pass --force to",
    "  overwrite them knowingly — --force lists them again before it writes.",
  ];
  return lines.join("\n");
}
