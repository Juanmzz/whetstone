/**
 * Appending engine-emitted signals. THIN.
 *
 * APPEND ONLY, with `appendFile`, never read-modify-write. The log is the evidence
 * the retro reasons over and the receipts point at; rewriting it to add a line is
 * how a concurrent gate run silently drops someone else's signal, and a lost signal
 * is invisible by construction.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
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
export async function readSignalLog(sddRoot: string): Promise<SignalRecord[]> {
  let text: string;
  try {
    text = await readFile(join(sddRoot, SIGNALS_PATH), "utf-8");
  } catch {
    return [];
  }
  return parseSignalLog(text);
}

/** Returns the ids written. Empty when there was nothing new to say. */
export async function appendSignals(
  sddRoot: string,
  signals: readonly EmittableSignal[],
  now: Date,
): Promise<string[]> {
  if (signals.length === 0) return [];

  const path = join(sddRoot, SIGNALS_PATH);
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
        source: s.source,
        fingerprint: s.fingerprint,
        rule_affected: [],
      }),
    );
  }

  await appendFile(path, `${lines.join("\n")}\n`, "utf-8");
  return ids;
}
