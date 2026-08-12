/**
 * The execution record. PURE — identity, sequencing, and the shape of one line.
 *
 * Why this exists next to `core/signals/` rather than inside it. They share a
 * mechanism (append-only JSONL under `.wst/`, a parser that fails closed) and have
 * opposite contracts. A SIGNAL is a judgment worth learning from: rare, deduped,
 * hand-editable, and deliberately silent about a run that passed, because "a log
 * that records success is a log nobody reads". An EVENT is the run itself: written
 * on every path, never deduped — the repetition IS the datum — and never edited,
 * because a corrupt line here is a bug, not a typo.
 *
 * Folding the second into the first would mean one file with two policies, and
 * `parse.ts`'s header already records what that cost the last time.
 *
 * ADR-0011 asks this primitive to pay three debts: observability (what is a run
 * doing right now), resumability (an event log IS a checkpoint), and comparison
 * (two agents on one task cannot be compared without a common record). Every field
 * below is here because one of the three needs it.
 */

import { createHash } from "node:crypto";

/**
 * CLOSED, unlike a signal's free-text `type`.
 *
 * The retro clusters signal types as prose, so an unrecognised one still carries
 * meaning. An event's consumers DISPATCH on kind — a reader renders it, a resume
 * decides what already happened, a comparison lines two runs up — and a kind none
 * of them knows is a line that cannot be rendered, resumed from, or compared.
 * Adding one is therefore a deliberate schema change, which is the point: this
 * contract propagates into every repo `init` touches.
 *
 * `check-started` is deliberately absent. It doubles the volume and `check-finished`
 * already carries `ms`; the only thing it buys is "what is running RIGHT NOW", which
 * is a real need that arrives with the reader, not with the log.
 */
export type EventKind =
  | "run-started"
  | "triage-classified"
  | "check-skipped"
  | "check-finished"
  | "run-finished"
  | "run-failed";

const KINDS: readonly string[] = [
  "run-started",
  "triage-classified",
  "check-skipped",
  "check-finished",
  "run-finished",
  "run-failed",
] satisfies readonly EventKind[];

export const isEventKind = (value: unknown): value is EventKind =>
  typeof value === "string" && KINDS.includes(value);

/**
 * What a caller observed. `run`, `seq` and `ts` are NOT here: they are stamped by
 * the writer, so no caller can mint an id, skip a number, or backdate a line.
 */
export interface EmittableEvent {
  readonly kind: EventKind;
  readonly detail: string;
  /** The check this is about, for the two `check-*` kinds. */
  readonly check?: string;
  /** A `CheckOutcome.status`, kept as a plain string so the two contracts stay independent. */
  readonly status?: string;
  readonly tier?: string;
  readonly ms?: number;
  readonly exit?: number;
}

/** One line of `events.jsonl`. Flat and greppable, like `SignalRecord`. */
export interface EventRecord extends EmittableEvent {
  /** Groups every line of one invocation. */
  readonly run: string;
  /**
   * Monotonic within the run, from zero.
   *
   * `ts` cannot order these on its own: a deterministic check that returns
   * instantly puts two events in one millisecond, and a log without a total order
   * can be read but not replayed. Replay is two of ADR-0011's three debts.
   */
  readonly seq: number;
  readonly ts: string;
}

/**
 * A run's id, derived from a seed rather than counted.
 *
 * The same lesson `signalId` records: an id allocated as `max(existing) + 1` is a
 * read-modify-write over an append-only file, and two gates in parallel worktrees
 * compute the same next number and both write it. Content-derived needs no read, so
 * there is nothing to race. The seed carries the start timestamp, so the same
 * command run twice gets two ids.
 */
export function runId(seed: string): string {
  return `run-${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 8)}`;
}

/**
 * Stamp an observation into a record.
 *
 * Absent optional fields are OMITTED, never written as `null` — the same rule as
 * `SignalRecord.branch`. `null` reads as present-and-empty, so a consumer cannot
 * tell "this check reported no duration" from "durations were not recorded when
 * this line was written".
 */
export function toRecord(
  run: string,
  seq: number,
  now: Date,
  event: EmittableEvent,
): EventRecord {
  return {
    run,
    seq,
    ts: now.toISOString(),
    kind: event.kind,
    detail: event.detail,
    ...(event.check !== undefined ? { check: event.check } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.tier !== undefined ? { tier: event.tier } : {}),
    ...(event.ms !== undefined ? { ms: event.ms } : {}),
    ...(event.exit !== undefined ? { exit: event.exit } : {}),
  };
}

/**
 * Where a caller hands an observation. Returns `void` and never rejects: the log is
 * bookkeeping, and bookkeeping that can fail a gate is worse than no bookkeeping
 * (the same rule `commands/gate.ts` already applies to signals). The adapter
 * serialises the writes and remembers any error for the caller to report at the end.
 */
export type EventSink = (event: EmittableEvent) => void;

/** For a gate that must not write — `--no-emit`, and every unit test of the pure core. */
export const NULL_SINK: EventSink = () => undefined;
