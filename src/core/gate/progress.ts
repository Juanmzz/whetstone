/**
 * What a reader is told while the gate is still working.
 *
 * PURE. An event and a destination in, lines out — nothing is written here.
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
