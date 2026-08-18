/**
 * What a reader is told while the gate is still working.
 *
 * PURE. An event and a destination in, lines out — nothing is written here.
 *
 * ## The failure
 *
 * `wst gate` printed nothing until every check had finished. Measured in a real
 * repo: typecheck ~3.3s, tests 6.7-19s, lint ~2.8s, and an end-to-end check that
 * starts two dev servers before it begins. For twenty-five seconds the terminal
 * showed nothing, which is indistinguishable from a hang — and a Ctrl-C taken
 * for a hang leaves half-written receipts.
 *
 * ## Why this is not an event kind
 *
 * `core/events/record.ts` says `check-started` is deliberately absent, and names
 * the exact condition for revisiting it: *"the only thing it buys is 'what is
 * running RIGHT NOW', which is a real need that arrives with the reader, not with
 * the log."* The reader has arrived; the log has not changed its mind. So this
 * renders from an in-process channel and never reaches `events.jsonl`, whose
 * schema propagates into every repo `init` touches.
 *
 * ## The constraint that shapes the output
 *
 * This output is CAPTURED — the pre-push hook reads it, CI stores it — so every
 * line is plain, with no escape sequence and no carriage return. A control code
 * in a log is noise a reader cannot strip.
 *
 * A first version rewrote the running line in place on a terminal. Running it
 * showed why that is wrong: checks execute CONCURRENTLY, so three are running
 * before the first finishes and there is no single line to rewrite. Interleaved
 * plain lines are what a parallel run actually looks like.
 */

export type ProgressEvent =
  | { readonly phase: "started"; readonly checkId: string }
  | {
      readonly phase: "finished";
      readonly checkId: string;
      readonly status: string;
      readonly ms: number;
    };

export interface ProgressTarget {
  /** `--json`: the caller owns the stream and a machine has no use for progress. */
  readonly quiet?: boolean;
}

/** `84ms`, `6.7s`. Below a second a rounded `0.0s` reads as a broken timer. */
function elapsed(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function progressLines(event: ProgressEvent, target: ProgressTarget): readonly string[] {
  if (target.quiet === true) return [];

  if (event.phase === "started") {
    // Off a terminal this is the only proof the run is alive, so it is printed
    // even though the finished line will repeat the name.
    return [`  running  ${event.checkId}`];
  }

  return [`  ${event.status.padEnd(8)} ${event.checkId.padEnd(14)} (${elapsed(event.ms)})`];
}
