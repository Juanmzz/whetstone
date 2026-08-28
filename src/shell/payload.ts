/**
 * Whetstone's OWN payload: the skills `init` copies verbatim into a target.
 *
 * Found by walking up from this module, so it works the same from `src/` under
 * tsx and from `dist/` after a build. THE WALK MUST STOP AT WHETSTONE'S OWN
 * PACKAGE ROOT: installed as a dependency the module sits under the target's
 * `node_modules/`, and an unbounded walk finds the TARGET's `.wst/skills` and
 * copies a project's own skills back onto itself, reporting success.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skillCopies } from "../core/init/payload.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { exists } from "./fs.js";

/** The name the walk stops at. Checked against package.json by `test/payload-root.test.ts`. */
export const PACKAGE_NAME = "@juanmzz/whetstone";

/**
 * Read here rather than at write time because `planInit` audits them: a skill
 * copied into a repo that never heard of Whetstone must not name `docs/PARALLEL.md`.
 * An empty map is legitimate and produces "not audited", which is a violation.
 */
export async function readSkills(payloadRoot: string | null): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  if (payloadRoot === null) return texts;
  for (const copy of skillCopies()) {
    try {
      texts.set(copy.from, await readFile(join(payloadRoot, copy.from), "utf-8"));
    } catch {
      /* absent here is the same as unreadable: reported, not passed */
    }
  }
  return texts;
}

export async function findPayloadRoot(): Promise<string | null> {
  let dir = import.meta.dirname;
  for (;;) {
    // Reached this package's own root? Answer from here, and never look higher.
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
        name?: string;
      };
      if (pkg.name === PACKAGE_NAME) {
        const root = join(dir, DEFINITION_DIR);
        return (await exists(join(root, "skills"))) ? root : null;
      }
    } catch {
      /* no package.json here — keep walking */
    }

    const parent = dirname(dir);
    // Never step out of the installed package into the consuming project.
    if (parent === dir || basename(dir) === "node_modules") return null;
    dir = parent;
  }
}
