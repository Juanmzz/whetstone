/**
 * Retro filesystem adapter. THIN: reads the signal log and the retro cursor, writes
 * proposals. All judgement about them lives in `core/retro/`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Signal } from "../core/retro/cluster.js";

export const RETRO_LOG = "memory/retro-log.md";
export const SIGNALS = "memory/signals.jsonl";
export const PROPOSALS_DIR = "memory/proposals";

export async function readSignals(sddRoot: string): Promise<Signal[]> {
  let text: string;
  try {
    text = await readFile(join(sddRoot, SIGNALS), "utf-8");
  } catch {
    return [];
  }
  const signals: Signal[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      signals.push(JSON.parse(line) as Signal);
    } catch {
      // A corrupt line must not be skipped silently: the retro would then cluster
      // over a subset while reporting it processed everything.
      throw new Error(`${SIGNALS}:${i + 1} is not valid JSON — fix it before running the retro`);
    }
  }
  return signals;
}

/**
 * The cursor is the last signal id a previous retro processed. Stored as a line
 * `cursor: sig-NNNN` in the newest retro-log entry.
 */
export async function readCursor(sddRoot: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(sddRoot, RETRO_LOG), "utf-8");
  } catch {
    return null;
  }
  const found = [...text.matchAll(/^cursor:\s*(sig-\d+)\s*$/gm)].pop();
  return found?.[1] ?? null;
}

export async function writeProposals(
  sddRoot: string,
  retroId: string,
  contents: string,
): Promise<string> {
  const dir = join(sddRoot, PROPOSALS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${retroId}.md`);
  await writeFile(path, contents, "utf-8");
  return path;
}
