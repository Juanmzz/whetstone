/**
 * `adr-refs` must fire on every directory that holds a decision citation.
 *
 * The check scans tracked files — all of them — but it only RUNS when the gate
 * selects it, and selection is `include`. Its first `include` listed six roots and
 * missed three dotted ones, so editing `.github/workflows/gate.yml` (which cites
 * adr-0009) or `.claude/hooks/lane-guard.mjs` (adr-0005) could break a citation and
 * fire nothing. The scan and the trigger have to agree.
 *
 * The dotted directories are the failure mode with teeth: `node:path`'s `matchesGlob`
 * will not let `**` cross a dot-leading segment (`core/triage/glob.ts` measures this),
 * so a broad-looking glob silently covers none of them.
 *
 * Run against the REAL registry, not a fixture. `gate/select.test.ts` already proves
 * the matcher works; what is worth pinning is this repo's own check file, where the
 * omission lived.
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

/** The three a `**`-shaped glob cannot reach, each holding a live citation today. */
const DOTTED: readonly ChangedFile[] = [
  changed(join(".github", "workflows", "gate.yml")),
  changed(join(".githooks", "pre-push")),
  changed(join(".claude", "hooks", "lane-guard.mjs")),
];

const CITING: readonly ChangedFile[] = [
  changed("AGENTS.md"),
  changed(join("src", "core", "retro", "propose.ts")),
  changed(join("scripts", "check-adr-refs.ts")),
  changed(join("test", "adr-refs.test.ts")),
  changed(join("docs", "PARALLEL.md")),
  changed(join(DEFINITION_DIR, "memory", "decisions.md")),
  changed(join(DEFINITION_DIR, "memory", "signals.jsonl")),
  ...DOTTED,
];

async function adrRefs(): Promise<LoadedCheck> {
  const registry = await loadRegistry(join(ROOT, DEFINITION_DIR));
  const check = registry.byId.get("adr-refs");
  if (check === undefined) throw new Error("adr-refs is not in this repo's check registry");
  return check;
}

describe("the adr-refs check in this repo's registry", () => {
  it("applies to every directory a citation can live in", async () => {
    const check = await adrRefs();

    const matched = matchFiles(check, CITING);

    expect(matched.map((f) => f.path)).toEqual(CITING.map((f) => f.path));
  });

  it("goes blind to the dotted directories once the globs naming them are dropped", async () => {
    const check = await adrRefs();
    const dotted = check.include.filter((glob) => glob.startsWith("."));

    const blinded = matchFiles({ ...check, include: check.include.filter((g) => !g.startsWith(".")) }, CITING);

    // Proves the mutation the test above guards against actually lands (TD7):
    // without it, green could mean "the include is right" or "some glob matches
    // everything", and those are not the same result.
    expect(dotted, "no include glob names a dot-leading directory").not.toHaveLength(0);
    for (const file of DOTTED) expect(blinded.map((f) => f.path)).not.toContain(file.path);
  });
});
