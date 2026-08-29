/**
 * Appending engine-emitted signals. THIN.
 *
 * ADDING a signal is APPEND ONLY, never read-modify-write. The log is the evidence
 * the retro reasons over and the receipts point at; rewriting it to add a line is
 * how a concurrent gate run silently drops someone else's signal, and a lost
 * signal is invisible by construction. The append itself is `shell/jsonl.ts`,
 * shared with the event log. `resolveSignal` at the bottom is the one write that
 * touches a stored line, and it says there what buys the exception.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gateSignalId, type EmittableSignal } from "../core/signals/emit.js";
import { parseSignalLog, type SignalRecord } from "../core/signals/parse.js";
import { markResolved } from "../core/signals/resolve.js";
import type { ResolveOutcome } from "../core/memory/port.js";
import { appendJsonl } from "./jsonl.js";

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

  const ids: string[] = [];
  const lines: string[] = [];
  for (const s of signals) {
    const id = gateSignalId(s.fingerprint, now.toISOString(), branch);
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

  await appendJsonl(path, lines);
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
  await appendJsonl(path, [JSON.stringify(record)]);
  return path;
}

/**
 * The ONE read-modify-write here: a field on a stored record cannot be set by
 * appending. The race is narrow because a human types this one at a time ([RC3])
 * where the gate appends unattended, and it is closed by writing a sibling temp
 * file and renaming: a reader sees the old log or the new one, never half.
 *
 * `core/signals/resolve.ts` decides WHETHER the write is allowed.
 */
export async function resolveSignal(
  definitionRoot: string,
  id: string,
  by: string,
): Promise<ResolveOutcome> {
  const path = join(definitionRoot, SIGNALS_PATH);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    return { ok: false, why: `no signal log at ${path}` };
  }

  const result = markResolved(text, id, by);
  if (!result.ok) return { ok: false, why: result.error };

  const temp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temp, result.text, "utf-8");
  await rename(temp, path);
  return { ok: true };
}
