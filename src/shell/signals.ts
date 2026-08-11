/**
 * Appending engine-emitted signals. THIN.
 *
 * APPEND ONLY, with `appendFile`, never read-modify-write. The log is the evidence
 * the retro reasons over and the receipts point at; rewriting it to add a line is
 * how a concurrent gate run silently drops someone else's signal, and a lost signal
 * is invisible by construction.
 */

import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { signalId, type EmittableSignal } from "../core/signals/emit.js";
import { parseSignalLog, type SignalRecord } from "../core/signals/parse.js";

export const SIGNALS_PATH = "memory/signals.jsonl";

/**
 * A MISSING log is empty; a CORRUPT one is not. Only the read is caught here —
 * parsing is `core/signals/parse.ts` and it throws, deliberately.
 *
 * This used to swallow the parse too, and that is how one corrupt line became the
 * gate's problem: an empty log deduplicates against nothing, so every signal was
 * re-emitted and the retro clustered on recurrence that never happened.
 */
export async function readSignalLog(definitionRoot: string): Promise<SignalRecord[]> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, SIGNALS_PATH), "utf-8");
  } catch {
    return [];
  }
  return parseSignalLog(text);
}

/**
 * `"\n"` when the file exists, is non-empty, and does not end in one — otherwise `""`.
 *
 * Hand-editing this log is the DOCUMENTED workflow and 45 of this repo's entries
 * were written that way, so a last line with no newline after it is the ordinary
 * state of the file. Appending to it welds two JSON objects onto one line, and the
 * parser fails closed by design: one bad line rejects the WHOLE log, so the retro
 * stops and the gate stops emitting until a human repairs a file that is supposed
 * to be append-only.
 *
 * One byte is read, not the file. This stays an append: a read-modify-write is how
 * a concurrent run silently drops someone else's signal. And the newline is added
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

/**
 * Returns the ids written. Empty when there was nothing new to say.
 *
 * `branch` is a REQUIRED parameter with a nullable type rather than an optional
 * one, so a new caller has to answer the question instead of inheriting an
 * unbranded signal by omission. It comes from the git adapter and from nowhere
 * else — a branch inferred from a ticket id or a task name is a guess wearing the
 * costume of a fact, and the retro would group work that never shared a branch.
 */
export async function appendSignals(
  definitionRoot: string,
  signals: readonly EmittableSignal[],
  now: Date,
  branch: string | null,
): Promise<string[]> {
  if (signals.length === 0) return [];

  const path = join(definitionRoot, SIGNALS_PATH);
  await mkdir(dirname(path), { recursive: true });

  const ids: string[] = [];
  const lines: string[] = [];
  for (const s of signals) {
    const id = signalId(s.fingerprint);
    ids.push(id);
    lines.push(
      JSON.stringify({
        id,
        ts: now.toISOString(),
        type: s.type,
        phase: s.phase,
        severity: s.severity,
        detail: s.detail,
        // Omitted, not nulled, on a detached HEAD. See `SignalRecord.branch`.
        ...(branch !== null ? { branch } : {}),
        source: s.source,
        fingerprint: s.fingerprint,
        rule_affected: [],
      }),
    );
  }

  await appendFile(path, `${await separator(path)}${lines.join("\n")}\n`, "utf-8");
  return ids;
}

/**
 * Append one already-built record, returning the path written. For `wst signal`,
 * where the record is composed and validated in `core/signals/human.ts` and this
 * only writes it.
 *
 * Same `appendFile`, same reason, and it is a SECOND function rather than a
 * generalisation of `appendSignals` on purpose: that one owns the machine path
 * (ids derived from fingerprints, `source: "gate"`, a batch to dedupe against the
 * log). Folding a human's single record into it would mean one branch deciding
 * which half of the contract applies, which is how two paths drift into each other.
 */
export async function appendSignalRecord(definitionRoot: string, record: SignalRecord): Promise<string> {
  const path = join(definitionRoot, SIGNALS_PATH);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${await separator(path)}${JSON.stringify(record)}\n`, "utf-8");
  return path;
}
