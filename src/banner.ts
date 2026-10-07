/**
 * The wordmark, shown only where a human typed the command: the help and `wst init`.
 * Never in `gate`, `ready --json`, `status`, `check` or `triage`, which run in hooks and CI.
 */

export const WORDMARK = "▓▒░ whetstone";

export const TAGLINE = "is this task ready? one honest answer";

/** Two lines, aligned under the wordmark. Callers add their own trailing newline. */
export function banner(version?: string): string {
  const head = version === undefined ? WORDMARK : `${WORDMARK} ${version}`;
  return `${head}\n    ${TAGLINE}`;
}
