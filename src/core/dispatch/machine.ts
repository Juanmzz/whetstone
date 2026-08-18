/**
 * `wst prepare` as data.
 *
 * PURE.
 *
 * What `prepare` produces — a leased worktree, a branch, a charter on disk — is
 * exactly what something else needs in order to act: open a session there, start
 * an agent, gate the result. That "something else" is usually not a person, and
 * until now the only way to get the three paths was to parse them out of English.
 *
 * ## Two things this refuses to flatten
 *
 * A lane is `{ id, enforced }`, never a bare string. The charter promising a
 * boundary nothing enforced is a defect this project already fixed once in prose;
 * repeating it in data would be the same mistake in a form that is harder to
 * notice, because a consumer reading `lane: "api"` would reasonably act on it.
 *
 * `dispatched` is stated rather than implied. adr-0014 split `wst run`: prepare
 * leases and STOPS, and a caller that assumed otherwise would wait for a process
 * nobody started.
 */

import type { EnvironmentGap } from "./environment.js";

export interface PrepareFacts {
  readonly task: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly charterPath: string;
  readonly lane: string | null;
  readonly laneGuard: boolean;
  readonly gaps: readonly EnvironmentGap[];
}

export interface PrepareEnvelope {
  readonly task: string;
  readonly worktree: string;
  readonly branch: string;
  readonly charter: string;
  /** `null` when none was asked for. Never a bare id — see the header. */
  readonly lane: { readonly id: string; readonly enforced: boolean } | null;
  /** What the worktree does not have. The prose is on the human side. */
  readonly missing: readonly { readonly kind: string; readonly paths: readonly string[] }[];
  /** Always false. Stated because adr-0014 makes it the contract. */
  readonly dispatched: false;
}

export function prepareEnvelope(facts: PrepareFacts): PrepareEnvelope {
  return {
    task: facts.task,
    worktree: facts.worktreePath,
    branch: facts.branch,
    charter: facts.charterPath,
    lane: facts.lane === null ? null : { id: facts.lane, enforced: facts.laneGuard },
    missing: facts.gaps.map((gap) => ({ kind: gap.kind, paths: [...gap.paths] })),
    dispatched: false,
  };
}
