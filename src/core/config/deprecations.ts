/**
 * Judges that were removed, and what a config still naming one should hear. PURE.
 *
 * Keyed by plain string on purpose: a retired judge is by definition no longer an
 * `Agent`, so typing it as one is a contradiction the compiler catches.
 */

import type { Agent } from "./schema.js";

interface Retirement {
  /** When it stopped serving, ISO. */
  readonly on: string;
  readonly why: string;
  readonly use: Agent;
}

export const RETIRED_JUDGES: Readonly<Record<string, Retirement>> = Object.freeze({
  gemini: {
    on: "2026-06-18",
    why: "Gemini CLI stopped serving individual accounts and Google moved to Antigravity",
    use: "antigravity",
  },
});

export function retirementOf(name: string): Retirement | null {
  return RETIRED_JUDGES[name] ?? null;
}

/** The message a config naming a removed judge gets instead of an enum error. */
export function retirementMessage(name: string): string | null {
  const gone = retirementOf(name);
  if (gone === null) return null;
  return `agent: \`${name}\` was removed. ${gone.why} on ${gone.on}. Use \`${gone.use}\` (the \`agy\` CLI).`;
}

/** The build each adapter's flag set was measured against. */
const VALIDATED: Readonly<Partial<Record<Agent, string>>> = Object.freeze({ claude: "2.1.224" });

export const VALIDATED_JUDGE_VERSION = "2.1.224";

/** Null where nobody measured one, so no drift can be claimed. */
export function validatedVersionFor(agent: Agent): string | null {
  return VALIDATED[agent] ?? null;
}
