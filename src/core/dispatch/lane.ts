/**
 * What `prepare` may honestly say about a lane.
 *
 * PURE.
 *
 * The fix here is only the sentence. Making the promise true means a lane guard
 * that reads `lanes.yaml` at run time instead of baking it in, shipped in the
 * plugin — which is adr-0010's shape and adr-0010 is not accepted.
 */

/** @returns the line to print, or null when no lane was requested. */
export function laneReport(lane: string | null, guardPresent: boolean): string | null {
  if (lane === null) return null;
  return guardPresent
    ? `${lane} (enforced by the lane guard)`
    : `${lane} (NOT enforced here — the charter asks, nothing stops you)`;
}
