/**
 * The wordmark. Presentation only — no decisions, so it lives beside `cli.ts`
 * rather than in `core/`.
 *
 * `▓▒░` is the grit going coarse to fine, which is the whole tool in three
 * characters: deterministic checks are the coarse pass, the calibrated lens is the
 * fine one. It is three block glyphs rather than a drawing on purpose — a rendered
 * shape depends on the reader's font and degrades into noise, and a CLI that opens
 * with a broken picture looks worse than one that opens with nothing.
 *
 * Shown where a HUMAN typed the command: `wst` bare, and `wst init`. Never in
 * `gate`, `status`, `check` or `triage` — those run inside hooks and CI, where a
 * banner is output somebody has to scroll past to find the failure.
 */

export const WORDMARK = "▓▒░ whetstone";

export const TAGLINE = "a self-sharpening standards layer";

/** Two lines, aligned under the wordmark. Callers add their own trailing newline. */
export function banner(version?: string): string {
  const head = version === undefined ? WORDMARK : `${WORDMARK} ${version}`;
  return `${head}\n    ${TAGLINE}`;
}
