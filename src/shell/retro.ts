/**
 * Retro filesystem adapter. THIN: reads the signal log and the retro cursor, writes
 * proposals. All judgement about them lives in `core/retro/`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Signal } from "../core/retro/cluster.js";
import { parseSignalLog } from "../core/signals/parse.js";

export const RETRO_LOG = "memory/retro-log.md";
export const SIGNALS = "memory/signals.jsonl";
export const PROPOSALS_DIR = "memory/proposals";

export async function readSignals(definitionRoot: string): Promise<Signal[]> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, SIGNALS), "utf-8");
  } catch {
    return [];
  }
  // Throws on a corrupt line, and that is the point: clustering over a subset while
  // reporting it processed everything is worse than stopping. The policy used to
  // live here and disagree with `shell/signals.ts`; it now lives in one place.
  return parseSignalLog(text);
}

/**
 * The cursor is the last signal id a previous retro processed. Stored as a line
 * `cursor: sig-NNNN` in the newest retro-log entry.
 */
export async function readCursor(definitionRoot: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, RETRO_LOG), "utf-8");
  } catch {
    return null;
  }
  const found = [...text.matchAll(/^cursor:\s*(sig-\d+)\s*$/gm)].pop();
  return found?.[1] ?? null;
}

export async function writeProposals(
  definitionRoot: string,
  retroId: string,
  contents: string,
): Promise<string> {
  const dir = join(definitionRoot, PROPOSALS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${retroId}.md`);
  await writeFile(path, contents, "utf-8");
  return path;
}
