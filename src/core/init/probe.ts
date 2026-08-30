/**
 * What `init` saw when it ran a repo's own commands. PURE.
 *
 * In a repo initialised before this, the only check that blocked was `typecheck`,
 * and it blocked on an assertion: nobody had run it. `test` and `lint` were held
 * at `warn` with the body saying to promote them "after the first green gate",
 * and nothing ever promoted. So a red suite stopped no one.
 *
 * `init` already holds all three commands, read off the repo's own manifest.
 * Running them once turns the seeded severity into a measurement, which is the
 * same rule that governs a judgment lens: authority comes from evidence.
 */

import type { Check } from "../checks/schema.js";

export type ProbeResult =
  | { readonly ran: true; readonly ok: boolean; readonly exitCode: number; readonly durationMs: number }
  | { readonly ran: false; readonly why: string };

/** Keyed by check id, for the three commands a repo declares. */
export type Probes = Readonly<Record<string, ProbeResult>>;

/**
 * Green means `block`; everything else means `warn`.
 *
 * `undefined` is not "assume fine": a caller that skipped the probe measured
 * nothing, and absence of evidence may never read as evidence.
 */
export function severityFor(probe: ProbeResult | undefined): Check["severity"] {
  return probe !== undefined && probe.ran && probe.ok ? "block" : "warn";
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** The evidence line, in the body, where the reader of the check will be. */
export function probeNote(probe: ProbeResult | undefined, date: string): string {
  if (probe === undefined) return "**Not measured.** `init` did not run this command, so it is held at `warn`.";
  if (!probe.ran) {
    return (
      `**Held at \`warn\`: \`init\` could not run this command** on ${date} (${probe.why}). ` +
      "Run it yourself, and raise `severity` to `block` once it is green."
    );
  }
  if (probe.ok) {
    return `**Measured on ${date}:** exit 0 in ${seconds(probe.durationMs)}. That run is what this check's \`block\` rests on.`;
  }
  return (
    `**Held at \`warn\`: it did not pass** on ${date} (exit ${String(probe.exitCode)} in ${seconds(probe.durationMs)}). ` +
    "A check that blocks from the first minute over something already red gets the gate switched off. " +
    "Fix it, then raise `severity` to `block`."
  );
}
