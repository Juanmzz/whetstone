/**
 * `.sdd/` filesystem adapter. THIN: reads files, hands text to the pure core.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry, parseCheckFile, type Registry } from "../core/checks/registry.js";
import { hashFixtureDir, loadCalibration } from "./calibration.js";
import type { TriageRule } from "../core/contracts.js";
import { DEFAULT_RULES, parseTriageRules } from "../core/triage/index.js";

export const CHECKS_DIR = "checks";
export const INDEX_FILE = "_index.json";
export const TRIAGE_FILE = "triage.yaml";

/**
 * Where a check says its fixtures live, read out of the raw frontmatter.
 *
 * Read by regex rather than by parsing, because this is needed BEFORE the parse that
 * would give it to us properly — the parse is what consumes the answer.
 */
function fixturesDirFor(contents: string): string {
  return /^\s*fixtures:\s*(\S+)\s*$/m.exec(contents)?.[1] ?? "test/fixtures";
}

export async function loadRegistry(sddRoot: string): Promise<Registry> {
  const dir = join(sddRoot, CHECKS_DIR);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return buildRegistry([]); // no checks/ yet is a valid empty registry
  }

  const files = entries.filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort();

  const checks = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(join(dir, file), "utf-8");
      const checkId = file.replace(/\.md$/, "");

      // Gathered for EVERY check, not only the ones that ask to block. Deciding here
      // whether the evidence is needed would mean parsing the file twice, and the
      // cheap read is not worth the second parse being a place the two can disagree.
      const receipt = await loadCalibration(sddRoot, checkId);
      const currentFixturesHash =
        receipt === null ? null : await hashFixtureDir(join(sddRoot, "..", fixturesDirFor(contents)));

      return parseCheckFile(file, contents, { receipt, currentFixturesHash });
    }),
  );

  return buildRegistry(checks);
}

export interface LoadedTriageRules {
  readonly rules: readonly TriageRule[];
  /** Where they came from, for the report. A path, or "built-in defaults". */
  readonly origin: string;
}

/**
 * The triage rules, or the built-in defaults when the repo has none.
 *
 * Lives here rather than in a command because BOTH `wst gate` and `wst pr` route
 * from it, and they must route identically: two commands that disagree about a
 * change's tier disagree about which checks apply, so the annotation would describe
 * a gate run that never happened. Same reasoning as `createCheckRunner` being
 * exported from `commands/gate.ts` instead of copied.
 */
export async function loadTriageRules(sddRoot: string): Promise<LoadedTriageRules> {
  const path = join(sddRoot, TRIAGE_FILE);
  try {
    return { rules: parseTriageRules(await readFile(path, "utf-8"), path), origin: path };
  } catch (cause) {
    // Only a MISSING file falls back. A malformed one is re-thrown by
    // `parseTriageRules` and must not be swallowed — silently ignoring rules
    // somebody wrote is how a change gets triaged at the wrong discipline.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { rules: DEFAULT_RULES, origin: "built-in defaults" };
    }
    throw cause;
  }
}

/** Writes the compiled index. Regenerable — it is a cache, not a source. */
export async function writeIndex(sddRoot: string, registry: Registry): Promise<string> {
  const path = join(sddRoot, CHECKS_DIR, INDEX_FILE);
  await writeFile(path, `${JSON.stringify(registry.index, null, 2)}\n`, "utf-8");
  return path;
}
