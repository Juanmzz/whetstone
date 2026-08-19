/**
 * Reading the log back. PURE — records in, runs out.
 */

import type { EventRecord } from "./record.js";

/**
 * How a run ended, or that it did not.
 *
 * `status` and `exit` are `null` rather than absent when the terminal line carried
 * neither, for the same reason `toRecord` omits an absent field instead of writing
 * `null`: here the shape is fixed and every consumer branches on it, so a missing
 * KEY would be a third state nobody handles.
 */
export type RunEnding =
  | {
      readonly kind: "finished";
      readonly detail: string;
      readonly status: string | null;
      readonly exit: number | null;
    }
  | { readonly kind: "failed"; readonly detail: string; readonly exit: number | null }
  /**
   * No `run-finished` and no `run-failed`. A run still going and a run killed
   * halfway leave an identical log, so this deliberately does NOT try to tell them
   * apart — it says only what is true of both: nothing recorded an ending.
   */
  | { readonly kind: "unterminated" };

export interface TimelineEntry {
  readonly event: EventRecord;
  /**
   * Milliseconds since the run's first event, or `null` when either timestamp
   * cannot be parsed. `parseEventLog` requires `ts` to be a STRING, not a date, so
   * `NaN` is reachable — and "NaNms" on a line reads like a measurement.
   */
  readonly offsetMs: number | null;
}

export interface RunSummary {
  readonly run: string;
  /** `ts` of the lowest-`seq` event. */
  readonly startedAt: string;
  /** `ts` of the terminal event, or `null` when there is none. */
  readonly endedAt: string | null;
  readonly eventCount: number;
  readonly events: readonly TimelineEntry[];
  readonly ending: RunEnding;
  /** First line to terminal line. `null` when the run never ended, or the clock will not parse. */
  readonly durationMs: number | null;
}

/** `Date.parse` without the `NaN`. */
function millis(ts: string): number | null {
  const value = Date.parse(ts);
  return Number.isNaN(value) ? null : value;
}

const isTerminal = (record: EventRecord): boolean =>
  record.kind === "run-finished" || record.kind === "run-failed";

function endingOf(ordered: readonly EventRecord[]): {
  ending: RunEnding;
  terminal: EventRecord | null;
} {
  // The LAST terminal line, not the first. A log holding both is malformed, and of
  // the two possible guesses the later one is the one that describes the run's
  // actual exit.
  let terminal: EventRecord | null = null;
  for (const record of ordered) if (isTerminal(record)) terminal = record;

  if (terminal === null) return { ending: { kind: "unterminated" }, terminal: null };
  if (terminal.kind === "run-failed") {
    return {
      ending: { kind: "failed", detail: terminal.detail, exit: terminal.exit ?? null },
      terminal,
    };
  }
  return {
    ending: {
      kind: "finished",
      detail: terminal.detail,
      status: terminal.status ?? null,
      exit: terminal.exit ?? null,
    },
    terminal,
  };
}

/**
 * Every run in the log, NEWEST FIRST, each with its events in `seq` order.
 *
 * Newest first because the question this reader was built for is "what just
 * happened", and a log that only grows puts that answer at the bottom of the file.
 */
export function summariseRuns(records: readonly EventRecord[]): RunSummary[] {
  const groups = new Map<string, EventRecord[]>();
  for (const record of records) {
    const existing = groups.get(record.run);
    if (existing === undefined) groups.set(record.run, [record]);
    else existing.push(record);
  }

  const summaries: RunSummary[] = [];
  for (const [run, group] of groups) {
    // Stable, so two lines sharing a `seq` — only possible in a log stitched
    // together from elsewhere — keep the order the file had rather than swapping
    // unpredictably between reads.
    const ordered = [...group].sort((a, b) => a.seq - b.seq);
    const first = ordered[0] as EventRecord;
    const startedMs = millis(first.ts);
    const { ending, terminal } = endingOf(ordered);
    const endedMs = terminal === null ? null : millis(terminal.ts);

    summaries.push({
      run,
      startedAt: first.ts,
      endedAt: terminal?.ts ?? null,
      eventCount: ordered.length,
      events: ordered.map((event) => {
        const at = millis(event.ts);
        return { event, offsetMs: startedMs === null || at === null ? null : at - startedMs };
      }),
      ending,
      durationMs: startedMs === null || endedMs === null ? null : endedMs - startedMs,
    });
  }

  return summaries.sort((a, b) => (millis(b.startedAt) ?? 0) - (millis(a.startedAt) ?? 0));
}

export type RunLookup =
  | { readonly kind: "found"; readonly summary: RunSummary }
  | { readonly kind: "unknown" }
  | { readonly kind: "ambiguous"; readonly matches: readonly string[] };

/**
 * A run by id, or by an unambiguous prefix of one.
 *
 * There is deliberately no fallback to the newest run. Answering a question about
 * run X with run Y's timeline is worse than an error, because the output is
 * indistinguishable from a correct answer.
 */
export function lookupRun(summaries: readonly RunSummary[], query: string): RunLookup {
  const exact = summaries.find((s) => s.run === query);
  if (exact !== undefined) return { kind: "found", summary: exact };

  const matches = summaries.filter((s) => s.run.startsWith(query));
  if (matches.length === 1) return { kind: "found", summary: matches[0] as RunSummary };
  if (matches.length === 0) return { kind: "unknown" };
  return { kind: "ambiguous", matches: matches.map((s) => s.run) };
}

/** What a `--follow` loop has not printed yet. */
export function entriesAfter(summary: RunSummary, seq: number): TimelineEntry[] {
  return summary.events.filter((e) => e.event.seq > seq);
}

/**
 * The log up to its last complete line. For `--follow` ONLY.
 *
 * A poll that lands between the write of a line and the write of its newline sees
 * half a record, and handing that half to `parseEventLog` would report a CORRUPT
 * log — the loudest thing this system can say — about a write that is merely still
 * in flight. A fragment with no newline after it is not yet a line.
 *
 * This is not a licence to swallow corruption. Anything before the last newline is
 * parsed normally and still throws, and the one-shot read (no `--follow`) does not
 * use this at all: there, a log that ends mid-line is a log that was truncated, and
 * `parse.ts` is right to say so.
 */
export function completeLinePrefix(text: string): string {
  const lastNewline = text.lastIndexOf("\n");
  return lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
}
