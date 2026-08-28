/**
 * Retro filesystem adapter. THIN: the cursor, and the proposals. Signals come
 * through `MemoryPort`.
 */

import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RETRO_LOG = "memory/retro-log.md";
export const PROPOSALS_DIR = "memory/proposals";


/**
 * Reading the cursor has three outcomes, and only two of them are answers.
 * `readCursor` collapses `none` and `unreadable` into `null` because a retro treats
 * both the same way; a reader being told a NUMBER cannot.
 */
export type CursorRead =
  | { readonly kind: "cursor"; readonly id: string }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * The last signal id a previous retro processed, from the newest `cursor:` line.
 *
 * The pattern accepts hex as well as digits: ids moved to hex at sig-0046 and a
 * digits-only pattern silently stopped matching, so every retro reprocessed the
 * whole log and billed for it again. It also stops at the id rather than at
 * end-of-line, because the retro's own summary suffix follows it.
 */
export async function readCursorResult(definitionRoot: string): Promise<CursorRead> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, RETRO_LOG), "utf-8");
  } catch (cause) {
    // A missing log means nothing was ever recorded. Anything else is a failed read.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "unreadable", reason: (cause as Error).message };
  }
  const found = [...text.matchAll(/^cursor:\s*(sig-[0-9a-z]+)\b/gm)].pop();
  return found === undefined ? { kind: "none" } : { kind: "cursor", id: found[1] as string };
}

/** The cursor, or null when there is not one to be had. */
export async function readCursor(definitionRoot: string): Promise<string | null> {
  const read = await readCursorResult(definitionRoot);
  return read.kind === "cursor" ? read.id : null;
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

/**
 * Append the mechanical half of a retro-log entry: the id, the cursor and the
 * counts. Returns the text written.
 *
 * **The cursor is a fact, not a judgment.** It used to be prose asking the human
 * to copy an id by hand, and the first time somebody forgot, the next retro
 * reprocessed the whole log and paid to re-propose over signals already handled.
 * What the human owns is the paragraph underneath: which proposals were applied
 * and which were refused.
 */
export async function appendRetroLogStub(
  definitionRoot: string,
  entry: { retroId: string; cursor: string; signals: number; clusters: number; actionable: number; costUsd: number },
): Promise<string> {
  const path = join(definitionRoot, RETRO_LOG);
  const text =
    `\n## ${entry.retroId}\n\n` +
    `cursor: ${entry.cursor} · ${entry.signals} signals · ${entry.clusters} clusters, ` +
    `${entry.actionable} actionable · $${entry.costUsd.toFixed(4)}\n\n` +
    `_Proposals written, none applied. Replace this line with what was accepted and refused._\n`;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, text, "utf-8");
  return text;
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
      `${path} already exists: a retro proposal was never applied, or the id collided. ` +
        `Move it aside before running again.`,
    );
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("already exists")) throw cause;
  }
  await writeFile(path, contents, "utf-8");
  return path;
}
