/**
 * Retro filesystem adapter. THIN: reads the signal log and the retro cursor, writes
 * proposals. All judgement about them lives in `core/retro/`.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
 * The last signal id a previous retro processed, from the newest `cursor:` line.
 *
 * The pattern accepts hex as well as digits: ids moved to hex at sig-0046 and a
 * digits-only pattern silently stopped matching, so every retro reprocessed the
 * whole log and billed for it again. It also stops at the id rather than at
 * end-of-line, because the retro's own summary suffix follows it.
 */
export async function readCursor(definitionRoot: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, RETRO_LOG), "utf-8");
  } catch {
    return null;
  }
  const found = [...text.matchAll(/^cursor:\s*(sig-[0-9a-z]+)\b/gm)].pop();
  return found?.[1] ?? null;
}

/**
 * How many retros have run, from the log's own entries.
 *
 * The id used to be the SIGNAL count, so `retro-0010.md` read as "the tenth
 * retro" while being the first, and two retros run at the same signal count
 * overwrote each other's file.
 */
export async function countRetros(definitionRoot: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, RETRO_LOG), "utf-8");
  } catch {
    return 0;
  }
  return [...text.matchAll(/^## retro-/gm)].length;
}

export async function writeProposals(
  definitionRoot: string,
  retroId: string,
  contents: string,
): Promise<string> {
  const dir = join(definitionRoot, PROPOSALS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${retroId}.md`);
  // Refuse rather than overwrite. A collision means the id scheme is wrong, and
  // silently replacing a proposal nobody read yet is the expensive way to learn.
  try {
    await access(path);
    throw new Error(
      `${path} already exists — a retro proposal was never applied, or the id collided. ` +
        `Move it aside before running again.`,
    );
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("already exists")) throw cause;
  }
  await writeFile(path, contents, "utf-8");
  return path;
}
