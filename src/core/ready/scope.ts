/**
 * Where the task's changes start. PURE.
 *
 * `wst ready` takes no arguments, so it has to answer this itself. Getting it wrong
 * is worse than refusing: a base that is too new verifies half the change and calls
 * it ready, and nobody looking at a green report can tell.
 *
 * Local references only. Fetching would make a verification command depend on the
 * network and on credentials, and a stale remote is a knowable state where a hung
 * fetch is not.
 */

export interface ScopeFacts {
  /** The checked-out branch, or null on a detached HEAD. */
  readonly branch: string | null;
  /** `@{upstream}` of the current branch, as `origin/x`, or null when unset. */
  readonly upstream: string | null;
  /** What `refs/remotes/origin/HEAD` points at, or null when it is not set. */
  readonly originHead: string | null;
  readonly localBranches: readonly string[];
  /** Remote-tracking branches, as `origin/x`. */
  readonly remoteBranches: readonly string[];
}

export type BaseResolution =
  | { readonly ok: true; readonly ref: string; readonly how: string }
  | { readonly ok: false; readonly why: string };

/** The names a default branch goes by, in the order a repo that has both means them. */
const DEFAULTS = ["main", "master"] as const;

export function resolveBase(facts: ScopeFacts): BaseResolution {
  if (facts.branch === null) {
    return {
      ok: false,
      why: "detached HEAD: there is no branch, so there is nothing to be ahead of. Check out a branch, or pass --range",
    };
  }

  const self = new Set([facts.branch, `origin/${facts.branch}`]);

  // The author set it, so it is the strongest statement about what this branch is
  // for. Unless it points at the branch itself, which `git push -u` writes and which
  // would make the base the last thing pushed rather than where the task began.
  if (facts.upstream !== null && !self.has(facts.upstream)) {
    return { ok: true, ref: facts.upstream, how: "the branch's upstream" };
  }

  // What a pull request would target, and it is a local ref: no network.
  if (facts.originHead !== null && !self.has(facts.originHead)) {
    return { ok: true, ref: facts.originHead, how: "origin/HEAD" };
  }

  const remote = DEFAULTS.map((n) => `origin/${n}`).filter(
    (r) => facts.remoteBranches.includes(r) && !self.has(r),
  );
  const local = DEFAULTS.filter((n) => facts.localBranches.includes(n) && !self.has(n));
  const found = remote.length > 0 ? remote : local;

  if (found.length > 1) {
    return {
      ok: false,
      why: `${found.join(" and ")} both exist and nothing points at either. Set origin/HEAD, set an upstream, or pass --range`,
    };
  }
  const only = found[0];
  if (only !== undefined) {
    return { ok: true, ref: only, how: remote.length > 0 ? "the only default branch on origin" : "the only local default branch" };
  }

  return {
    ok: false,
    why: "no default branch found among origin/HEAD, an upstream, main or master. Pass --range to say what to verify",
  };
}
