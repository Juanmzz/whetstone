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

/**
 * Standing on the default branch, the task is the divergence from its own remote.
 *
 * Not the same rule as a work branch, and deliberately: there `origin/<branch>` is
 * NOT a base, because it excludes commits of the same task that were already
 * pushed. On the default branch there is no parent to diff against, so the remote
 * counterpart is the only boundary the task has, and `HEAD` would drop every
 * committed-but-unpushed change from the scope.
 */
function standingOnDefault(facts: ScopeFacts, how: string): BaseResolution {
  const mirror = `origin/${facts.branch ?? ""}`;
  return facts.remoteBranches.includes(mirror)
    ? { ok: true, ref: mirror, how: `${how}, so the base is what it tracks` }
    : { ok: true, ref: "HEAD", how: `${how}, and it has no remote, so the base is the last commit` };
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

  // `origin/HEAD` naming the branch we are ON is positive evidence of standing on
  // the default, and it has to be read BEFORE the name search. Discarded as `self`,
  // it let a stale `origin/master` beside it become the base: a ref that is not
  // this branch's history at all.
  if (facts.originHead === `origin/${facts.branch}`) {
    return standingOnDefault(facts, "origin/HEAD names this branch");
  }

  // Candidates by NAME, across both namespaces. A remote candidate outranks a local
  // one only where they name the SAME branch: `origin/main` beside a local `main` is
  // one default seen twice, but `origin/main` beside a local `master` is two
  // different claims about what the default is, and nothing here points at either.
  // Preferring the remote there silently picks one, and if it is the newer, the
  // scope quietly loses part of the change.
  const names = DEFAULTS.filter(
    (n) =>
      (facts.remoteBranches.includes(`origin/${n}`) && !self.has(`origin/${n}`)) ||
      (facts.localBranches.includes(n) && !self.has(n)),
  );

  if (names.length > 1) {
    return {
      ok: false,
      why: `${names.join(" and ")} both exist and nothing points at either. Set origin/HEAD, set an upstream, or pass --range`,
    };
  }
  const name = names[0];
  if (name !== undefined) {
    const remote = `origin/${name}`;
    return facts.remoteBranches.includes(remote) && !self.has(remote)
      ? { ok: true, ref: remote, how: "the only default branch on origin" }
      : { ok: true, ref: name, how: "the only local default branch" };
  }

  // LAST, and only once nothing else resolved. Standing on the default branch is
  // not ambiguity: there is no branch to be ahead of, so the task is whatever is
  // uncommitted. But the NAME alone is not evidence of being on it. Checked first,
  // this returned `HEAD` on a task branch called `main` in a repo whose default is
  // `origin/master`, silently dropping every commit on that branch from the scope.
  // A base that is too new is the one error that reports a half-verified change as
  // fully verified.
  if ((DEFAULTS as readonly string[]).includes(facts.branch)) {
    return standingOnDefault(facts, "this is the default branch");
  }

  return {
    ok: false,
    why: "no default branch found among origin/HEAD, an upstream, main or master. Pass --range to say what to verify",
  };
}
