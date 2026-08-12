/**
 * Appending to a JSONL log under `.wst/`. THIN, and the ONE place that knows how.
 *
 * APPEND ONLY, with `appendFile`, never read-modify-write. Two of these logs exist
 * now — `memory/signals.jsonl` and `events.jsonl` — and a read-modify-write on
 * either is how a concurrent run silently drops someone else's line. A lost line is
 * invisible by construction.
 *
 * Extracted rather than copied when the event log arrived. This repo has three bugs
 * on record that were one rule implemented twice and drifting; the separator logic
 * below is subtle enough (see `separator`) that a second copy would be a fourth.
 */

import { appendFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * `"\n"` when the file exists, is non-empty, and does not end in one — otherwise `""`.
 *
 * `signals.jsonl` is hand-edited as a documented workflow and 45 of this repo's
 * entries were written that way, so a last line with no newline after it is the
 * ordinary state of that file. `events.jsonl` is never hand-edited, but a process
 * killed mid-append leaves exactly the same shape. Appending blind welds two JSON
 * objects onto one line, and both parsers fail closed on it.
 *
 * One byte is read, not the file, so this stays an append. And the newline is added
 * only when it is missing — an unconditional one grows a blank line per append.
 */
async function separator(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return ""; // no file yet; `appendFile` creates it
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return "";
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] === 0x0a ? "" : "\n";
  } finally {
    await handle.close();
  }
}

/** Appends one write. Nothing is written when there is nothing to say. */
export async function appendJsonl(path: string, lines: readonly string[]): Promise<void> {
  if (lines.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${await separator(path)}${lines.join("\n")}\n`, "utf-8");
}
