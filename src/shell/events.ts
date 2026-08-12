/**
 * The event log adapter. THIN — it stamps, serialises and appends.
 *
 * Lives at `.wst/events.jsonl`, NOT under `.wst/memory/`. `memory/` is the
 * human-gated layer: ADRs, `signals.jsonl`, `proposals/` — things a person writes,
 * reads and edits. This file is machine-written, never edited, and feeds no
 * decision. Filing it there would make "everything in `memory/` is human-gated"
 * false, which is a load-bearing sentence in the constitution.
 *
 * Each event is appended AS IT HAPPENS rather than buffered to the end of the run.
 * A log flushed on exit answers "what did that run do" and not "what is this run
 * doing", and the second question is the one ADR-0011 says is unanswerable today.
 * The cost is one small append per event; a gate run produces single digits of them.
 *
 * Writes are SERIALISED through one promise chain. Two concurrent `appendFile`s on
 * the deterministic checks — which run under `Promise.all` — is how two lines get
 * interleaved into one corrupt line.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEventLog } from "../core/events/parse.js";
import { runId, toRecord, type EventRecord, type EventSink } from "../core/events/record.js";
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

/** A MISSING log is empty; a CORRUPT one throws, from `core/events/parse.ts`. */
export async function readEventLog(definitionRoot: string): Promise<EventRecord[]> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, EVENTS_PATH), "utf-8");
  } catch {
    return [];
  }
  return parseEventLog(text);
}
