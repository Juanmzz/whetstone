/**
 * What a reader is told while a slow step is still working. PURE.
 *
 * `gate` had a heartbeat and `retro` had nothing: it printed the cluster it was
 * about to judge and then went silent for as long as the model took, which is
 * indistinguishable from a hang (adr-0028).
 *
 * Two renderings of one fact, because the two destinations are not alike. A
 * terminal gets a line it overwrites in place. A pipe or a CI log gets a plain
 * line every so often, since a carriage return there is a log nobody can read.
 */

/** How long before a step has to say it is still there, and how often after. */
export const HEARTBEAT_MS = 10_000;

/** The stone's own shades. One cell, and it reads as material rather than as a toy. */
export const SPINNER: readonly string[] = Object.freeze(["░", "▒", "▓", "█", "▓", "▒"]);

/** `84ms`, `6.7s`. Below a second a rounded `0.0s` reads as a broken timer. */
function elapsed(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function liveLine(label: string, ms: number, frame: number): string {
  const at = ((frame % SPINNER.length) + SPINNER.length) % SPINNER.length;
  return `  ${SPINNER[at] ?? ""} ${label} (${elapsed(ms)})`;
}

export function quietLine(label: string, ms: number): string {
  return `  ... ${label} (${elapsed(ms)})`;
}

/**
 * One line for every check in flight at once.
 *
 * NOT one spinner per check. That was tried and reverted: the gate runs its
 * deterministic checks concurrently, so three of them reporting at the same time
 * have no single line to rewrite and each mangles the ones beside it.
 */
export function runningLine(ids: readonly string[], ms: number, frame: number): string {
  return ids.length === 0 ? "" : liveLine(`running: ${ids.join(", ")}`, ms, frame);
}
