/**
 * Judges that stopped serving, and what replaced them. PURE.
 *
 * A judge listed in the schema reads as one you can pick. Saying nothing about
 * one that no longer answers hands most people a reviewer that cannot run, and
 * the failure arrives as a spawn error at gate time rather than at the moment
 * they chose it.
 */

import type { Agent } from "./schema.js";

interface Retirement {
  /** When it stopped serving, ISO. */
  readonly on: string;
  /** Who is unaffected, so a licensed repo is not scared off it. */
  readonly stillServes: string;
  readonly successor: string;
}

export const RETIRED_JUDGES: Readonly<Partial<Record<Agent, Retirement>>> = Object.freeze({
  gemini: {
    on: "2026-06-18",
    stillServes: "Gemini Code Assist Standard and Enterprise licences",
    successor: "Antigravity CLI",
  },
});

export function judgeWarning(agent: Agent): string | null {
  const retired = RETIRED_JUDGES[agent];
  if (retired === undefined) return null;
  return (
    `\`${agent}\` stopped serving individual accounts on ${retired.on}; ` +
    `${retired.stillServes} carry on. Google's successor is ${retired.successor}, ` +
    `which Whetstone has no adapter for yet: writing one against undocumented ` +
    `flags is the guess hard rule 8 forbids.`
  );
}

/** The build each adapter's flag set was measured against. */
const VALIDATED: Readonly<Partial<Record<Agent, string>>> = Object.freeze({ claude: "2.1.224" });

export const VALIDATED_JUDGE_VERSION = "2.1.224";

/** Null where nobody measured one, so no drift can be claimed. */
export function validatedVersionFor(agent: Agent): string | null {
  return VALIDATED[agent] ?? null;
}
