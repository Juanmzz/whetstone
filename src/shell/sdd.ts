/**
 * `.sdd/` filesystem adapter. THIN: reads files, hands text to the pure core.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry, parseCheckFile, type Registry } from "../core/checks/registry.js";
import type { TriageRule } from "../core/contracts.js";
import { DEFAULT_RULES, parseTriageRules } from "../core/triage/index.js";

export const CHECKS_DIR = "checks";
export const INDEX_FILE = "_index.json";
export const TRIAGE_FILE = "triage.yaml";

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
    files.map(async (file) => parseCheckFile(file, await readFile(join(dir, file), "utf-8"))),
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
