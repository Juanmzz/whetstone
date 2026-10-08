/**
 * Why a run could not establish readiness. PURE.
 *
 * INCOMPLETE is the result an agent can do least with on its own: nothing failed,
 * so there is no output to read. The sentence is the whole of what it has to go on.
 */

import { DEFINITION_DIR } from "../paths.js";

export interface IncompleteFacts {
  /** Whether the definition directory exists at all. */
  readonly definitions: boolean;
  /** How many checks the registry holds, enabled or not. */
  readonly checks: number;
  readonly uncovered: readonly string[];
  readonly errored: readonly string[];
  /** Switched off, and would have matched these paths. */
  readonly declined: readonly string[];
  /** Left out by `--fast`, and may block. */
  readonly omitted: readonly string[];
  /** May block, applied, and produced no verdict: a method, or a skip with no receipt. */
  readonly unrun: readonly string[];
}

const MAX_PATHS = 10;

const NO_DEFINITIONS = `no ${DEFINITION_DIR}/ in this repository, so there are no checks to run. Run \`wst init\`.`;

const checks = (n: number): string => `${String(n)} check${n === 1 ? "" : "s"}`;

function uncoveredSentence(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_PATHS).join(", ");
  const more = paths.length > MAX_PATHS ? `, and ${String(paths.length - MAX_PATHS)} more` : "";
  const one = paths.length === 1;
  return `no check covers ${String(paths.length)} changed path${one ? "" : "s"}, so nothing verified ${one ? "it" : "them"}: ${shown}${more}`;
}

export function whyIncomplete(facts: IncompleteFacts): string {
  if (!facts.definitions) return NO_DEFINITIONS;
  if (facts.checks === 0) {
    return `init seeded no checks: ${DEFINITION_DIR}/checks/ is empty, so nothing can verify this change. Add a check there, or run \`wst init\` again.`;
  }

  const causes: string[] = [];
  if (facts.errored.length > 0) {
    causes.push(
      `${checks(facts.errored.length)} could not run: ${facts.errored.join(", ")}. That is the check failing to start, not a verdict on this change.`,
    );
  }
  if (facts.declined.length > 0) {
    causes.push(
      `${checks(facts.declined.length)} that would cover this change ${facts.declined.length === 1 ? "is" : "are"} switched off: ${facts.declined.join(", ")}`,
    );
  }
  if (facts.omitted.length > 0) {
    causes.push(`${checks(facts.omitted.length)} left out by --fast: ${facts.omitted.join(", ")}. Rerun without --fast.`);
  }
  if (facts.unrun.length > 0) {
    causes.push(`${checks(facts.unrun.length)} that may block did not run: ${facts.unrun.join(", ")}`);
  }

  if (facts.uncovered.length > 0) {
    causes.push(`${causes.length === 0 ? "" : "also, "}${uncoveredSentence(facts.uncovered)}`);
  }
  return causes.length === 0 ? "no check ran over this change, so nothing verified it" : causes.join("\n");
}

/** A clean tree reads the same with and without checks, so the missing directory is said. */
export function whyNothingToVerify(definitions: boolean): string | undefined {
  return definitions ? undefined : NO_DEFINITIONS;
}
