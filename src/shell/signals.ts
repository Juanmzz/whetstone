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
import type { EmittableSignal, ExistingSignal } from "../core/signals/emit.js";

export const SIGNALS_PATH = "memory/signals.jsonl";

interface LoggedSignal extends ExistingSignal {
  readonly id?: string;
}

export async function readSignalLog(sddRoot: string): Promise<LoggedSignal[]> {
  try {
    const text = await readFile(join(sddRoot, SIGNALS_PATH), "utf-8");
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as LoggedSignal);
  } catch {
    return [];
  }
}

function nextId(existing: readonly LoggedSignal[]): number {
  let max = 0;
  for (const s of existing) {
    const n = Number(/^sig-(\d+)$/.exec(s.id ?? "")?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max + 1;
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

  const existing = await readSignalLog(sddRoot);
  let n = nextId(existing);

  const ids: string[] = [];
  const lines: string[] = [];
  for (const s of signals) {
    const id = `sig-${String(n++).padStart(4, "0")}`;
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
