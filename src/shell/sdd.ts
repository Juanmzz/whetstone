/**
 * `.sdd/` filesystem adapter. THIN: reads files, hands text to the pure core.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry, parseCheckFile, type Registry } from "../core/checks/registry.js";

export const CHECKS_DIR = "checks";
export const INDEX_FILE = "_index.json";

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

/** Writes the compiled index. Regenerable — it is a cache, not a source. */
export async function writeIndex(sddRoot: string, registry: Registry): Promise<string> {
  const path = join(sddRoot, CHECKS_DIR, INDEX_FILE);
  await writeFile(path, `${JSON.stringify(registry.index, null, 2)}\n`, "utf-8");
  return path;
}
