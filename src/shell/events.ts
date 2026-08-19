/**
 * The event log adapter. THIN — it stamps, serialises and appends.
 */

import { unwatchFile, watchFile } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEventLog } from "../core/events/parse.js";
import { runId, toRecord, type EventRecord, type EventSink } from "../core/events/record.js";
import { completeLinePrefix } from "../core/events/timeline.js";
import { appendJsonl } from "./jsonl.js";

/** Relative to the definition root — `.wst/events.jsonl`. */
export const EVENTS_PATH = "events.jsonl";

export interface EventLog {
  /** The id every line of this run carries. Printed, so a human can grep for it. */
  readonly run: string;
  readonly sink: EventSink;
  /**
   * Wait for every queued append, then report the first failure as a message, or
   * `null`. Nothing here ever rejects: the verdict is the product, the log is
   * bookkeeping, and bookkeeping that can break a gate is worse than no bookkeeping.
   * Silent failure is the other bad option, so the error is kept for the caller to
   * print rather than swallowed.
   */
  drain(): Promise<string | null>;
}

/**
 * `seed` is what makes the run id: the command and range, plus the start time, so
 * the same command run twice does not collide. It is a PARAMETER because deriving
 * it here would mean this adapter knowing what a range is.
 */
export function createEventLog(definitionRoot: string, seed: string, now: () => Date): EventLog {
  const path = join(definitionRoot, EVENTS_PATH);
  const run = runId(seed);

  let seq = 0;
  let tail: Promise<void> = Promise.resolve();
  let firstError: string | null = null;

  const sink: EventSink = (event) => {
    // Stamped SYNCHRONOUSLY, at the moment of observation. Doing it inside the
    // queued write would date every line by when the disk got to it and hand out
    // sequence numbers in completion order, which is exactly the ordering `seq`
    // exists to stop depending on.
    const line = JSON.stringify(toRecord(run, seq++, now(), event));
    tail = tail.then(async () => {
      try {
        await appendJsonl(path, [line]);
      } catch (cause) {
        firstError ??= (cause as Error).message;
      }
    });
  };

  return { run, sink, drain: async () => (await tail, firstError) };
}

/** `null` when there is no log at all, which is not an error — it is a repo that has not run the gate. */
async function readLogText(definitionRoot: string): Promise<string | null> {
  try {
    return await readFile(join(definitionRoot, EVENTS_PATH), "utf-8");
  } catch {
    return null;
  }
}

/** A MISSING log is empty; a CORRUPT one throws, from `core/events/parse.ts`. */
export async function readEventLog(definitionRoot: string): Promise<EventRecord[]> {
  const text = await readLogText(definitionRoot);
  return text === null ? [] : parseEventLog(text);
}

/**
 * The same read, stopping at the last COMPLETE line. For `wst events --follow` only.
 *
 * A poll that lands between the write of a line and the write of its newline sees
 * half a record. Handing that half to `parseEventLog` would report the log as
 * CORRUPT — the loudest thing this system says about this file — for a write that
 * is merely still in flight, and it would do it while tailing a live run, which is
 * exactly when the log is being appended to.
 *
 * This is not a quieter parser. Everything before the last newline is parsed
 * normally and still throws; only a trailing fragment, which is not yet a line, is
 * left for the next poll. The one-shot read above deliberately does NOT use it: a
 * finished log that ends mid-line was truncated, and that is worth saying.
 */
export async function readCompleteEvents(definitionRoot: string): Promise<EventRecord[]> {
  const text = await readLogText(definitionRoot);
  return text === null ? [] : parseEventLog(completeLinePrefix(text));
}

/** How often `--follow` looks. Fast enough to feel live, slow enough to cost nothing. */
export const FOLLOW_INTERVAL_MS = 300;

/**
 * Call `onChange` whenever the log is touched. Returns the stopper.
 *
 * `fs.watchFile` POLLS, and that is the deliberate choice: `fs.watch` is
 * inotify-backed and its behaviour differs per platform, per editor and across
 * network and container filesystems — and a watcher that silently stops firing
 * makes a tail that silently stops tailing. A `stat` every 300ms is not a cost
 * worth engineering around, and it brings in no dependency, which is the constraint
 * this flag was given.
 *
 * A path that does not exist yet is fine: `watchFile` polls it and fires when the
 * file appears, so following a run whose first append has not landed still works.
 */
export function watchEventLog(
  definitionRoot: string,
  onChange: () => void,
  intervalMs: number = FOLLOW_INTERVAL_MS,
): () => void {
  const path = join(definitionRoot, EVENTS_PATH);
  const listener = (): void => onChange();
  watchFile(path, { interval: intervalMs }, listener);
  // Unwatching also releases the event loop, which is what lets the process exit
  // once the run being followed has ended.
  return () => unwatchFile(path, listener);
}
