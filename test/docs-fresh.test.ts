/**
 * `docs-fresh` must watch every file whose content it counts.
 *
 * The check's own body states the rule: "the check has to fire on the change that
 * made the claim false, not on the change that admits it." Its `include` did not
 * hold to it — `AGENTS.md`, `src/cli.ts` and the decision record were listed, the
 * signal log was not — so appending a signal falsified the status block silently
 * and it only turned red on whatever unrelated change came next. That happened
 * twice on 2026-08-14, once from the gate's own emitter (`sig-a9ff00c4`).
 *
 * The assertion runs against the REAL registry rather than a fixture: a fixture
 * would prove the glob matcher works, which `gate/select.test.ts` already does.
 * What is worth pinning is this repo's own check file, where the omission lived.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../src/core/diff/parse.js";
import type { LoadedCheck } from "../src/core/checks/registry.js";
import { matchFiles } from "../src/core/gate/select.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { loadRegistry } from "../src/shell/sdd.js";

const ROOT = join(import.meta.dirname, "..");

const changed = (path: string): ChangedFile => ({ path, status: "modified" });

const SIGNAL_LOG = changed(join(DEFINITION_DIR, "memory", "signals.jsonl"));

/**
 * Every source `scripts/check-docs-fresh.ts` reads to decide pass or fail: the
 * file carrying the claim, and the three the numbers are counted from.
 */
const COUNTED: readonly ChangedFile[] = [
  changed("AGENTS.md"),
  changed(join("src", "cli.ts")),
  SIGNAL_LOG,
  changed(join(DEFINITION_DIR, "memory", "decisions.md")),
];

async function docsFresh(): Promise<LoadedCheck> {
  const registry = await loadRegistry(join(ROOT, DEFINITION_DIR));
  const check = registry.byId.get("docs-fresh");
  if (check === undefined) throw new Error("docs-fresh is not in this repo's check registry");
  return check;
}

describe("the docs-fresh check in this repo's registry", () => {
  it("applies to every file whose content it counts", async () => {
    const check = await docsFresh();

    const matched = matchFiles(check, COUNTED);

    expect(matched.map((f) => f.path)).toEqual(COUNTED.map((f) => f.path));
  });

  it("goes blind to the signal log once the globs covering it are dropped", async () => {
    const check = await docsFresh();
    const covering = check.include.filter(
      (glob) => matchFiles({ ...check, include: [glob] }, [SIGNAL_LOG]).length === 1,
    );

    const blinded = matchFiles(
      { ...check, include: check.include.filter((glob) => !covering.includes(glob)) },
      COUNTED,
    );

    // Proves the mutation the test above guards against actually lands (TD7).
    // Without it, green could mean "the include is right" or "every glob matches
    // everything", and those are not the same result.
    expect(covering, "no include glob covers the signal log").not.toHaveLength(0);
    expect(blinded.map((f) => f.path)).not.toContain(SIGNAL_LOG.path);
  });
});
