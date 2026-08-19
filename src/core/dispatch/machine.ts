/**
 * `wst prepare` as data.
 *
 * PURE.
 *
 * `dispatched` is stated rather than implied. adr-0014 split `wst run`: prepare
 * leases and STOPS, and a caller that assumed otherwise would wait for a process
 * nobody started.
 */

import type { EnvironmentGap } from "./environment.js";

export interface PrepareFacts {
  readonly task: string;
  /** Whether a worktree was actually leased. `false` under `--dry-run`. */
  readonly leased: boolean;
  /** Where the lease landed. Ignored when `leased` is false. */
  readonly worktreePath: string;
  readonly branch: string;
  /** Where the charter was written. Ignored when `leased` is false. */
  readonly charterPath: string;
  /** The charter as text. Only a dry run has one — there is no file to read. */
  readonly charterText?: string;
  readonly lane: string | null;
  readonly laneGuard: boolean;
  readonly gaps: readonly EnvironmentGap[];
}

export interface PrepareEnvelope {
  readonly task: string;
  /** Whether anything exists on disk. `false` under `--dry-run`. */
  readonly leased: boolean;
  /** `null` when nothing was leased. */
  readonly worktree: string | null;
  readonly branch: string;
  /** The charter PATH, or `null` when nothing was leased. Never the text. */
  readonly charter: string | null;
  /** The charter TEXT, and only for a dry run. `null` once a file exists to read. */
  readonly charterPreview: string | null;
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
    leased: facts.leased,
    worktree: facts.leased ? facts.worktreePath : null,
    branch: facts.branch,
    charter: facts.leased ? facts.charterPath : null,
    charterPreview: facts.leased ? null : (facts.charterText ?? null),
    lane: facts.lane === null ? null : { id: facts.lane, enforced: facts.laneGuard },
    missing: facts.gaps.map((gap) => ({ kind: gap.kind, paths: [...gap.paths] })),
    dispatched: false,
  };
}
