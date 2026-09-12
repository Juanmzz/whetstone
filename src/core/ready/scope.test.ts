import { describe, expect, it } from "vitest";
import { resolveBase, type ScopeFacts } from "./scope.js";

const facts = (over: Partial<ScopeFacts> = {}): ScopeFacts => ({
  branch: "feat/x",
  upstream: null,
  originHead: null,
  localBranches: ["main", "feat/x"],
  remoteBranches: ["origin/main", "origin/feat/x"],
  ...over,
});

describe("resolveBase — where the task's changes start", () => {
  it("prefers the branch's own upstream, which is what the author set", () => {
    const base = resolveBase(facts({ upstream: "origin/release-2" }));
    expect(base.ok && base.ref).toBe("origin/release-2");
    expect(base.ok && base.how).toMatch(/upstream/i);
  });

  it("falls back to origin/HEAD, which names the default branch without fetching", () => {
    const base = resolveBase(facts({ originHead: "origin/main" }));
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("finds a local `main` when there is no remote at all", () => {
    const base = resolveBase(facts({ remoteBranches: [], localBranches: ["main", "feat/x"] }));
    expect(base.ok && base.ref).toBe("main");
  });

  it("finds `master`, since not every repo renamed", () => {
    const base = resolveBase(facts({ remoteBranches: [], localBranches: ["master", "feat/x"] }));
    expect(base.ok && base.ref).toBe("master");
  });

  it("refuses to guess when both `main` and `master` exist and nothing points at one", () => {
    // Claiming readiness against the wrong base verifies the wrong change, which is
    // worse than saying the scope is ambiguous.
    const base = resolveBase(facts({ remoteBranches: [], localBranches: ["main", "master", "feat/x"] }));
    expect(base.ok).toBe(false);
    expect(!base.ok && base.why).toMatch(/main.*master|ambiguous/i);
  });

  it("diffs the default branch against its own remote, not against HEAD", () => {
    // Fourth finding from the same review. On `main` tracking `origin/main` with
    // unpushed commits, `HEAD` verified only the working tree and dropped every
    // committed-but-unpushed change. On the default branch there is no parent
    // branch, so what it tracks IS the boundary of the task.
    const base = resolveBase(
      facts({ branch: "main", upstream: "origin/main", originHead: "origin/main", localBranches: ["main"], remoteBranches: ["origin/main"] }),
    );
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("falls back to HEAD only where the default branch has no remote at all", () => {
    const base = resolveBase(facts({ branch: "main", localBranches: ["main"], remoteBranches: [] }));
    expect(base.ok && base.ref).toBe("HEAD");
  });

  it("still refuses a work branch's own remote as a base", () => {
    // The control, and the reason the two cases are not one rule: on `feat/x`,
    // `origin/feat/x` excludes commits of this same task that were already pushed.
    const base = resolveBase(facts({ upstream: "origin/feat/x", originHead: "origin/main" }));
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("takes origin/HEAD naming this branch as proof of standing on the default", () => {
    // Third finding from the same review. `origin/HEAD` pointing at the checked-out
    // branch says it IS the default; discarded as `self`, a stale `origin/master`
    // beside it became the base, which is not this branch's history at all.
    const base = resolveBase(
      facts({ branch: "main", originHead: "origin/main", localBranches: ["main"], remoteBranches: ["origin/main", "origin/master"] }),
    );
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("does the same when the default is `master` and a `main` exists beside it", () => {
    const base = resolveBase(
      facts({ branch: "master", originHead: "origin/master", localBranches: ["master", "main"], remoteBranches: ["origin/master"] }),
    );
    expect(base.ok && base.ref).toBe("origin/master");
  });

  it("refuses when the local default and the remote one are named differently", () => {
    // Second finding from the same cross-vendor review. A local `master` beside an
    // `origin/main`, with nothing pointing at either, is two claims about what the
    // default is. Preferring the remote picks one silently, and if it is the newer,
    // the scope loses part of the change.
    const base = resolveBase(
      facts({ branch: "feature", localBranches: ["master", "feature"], remoteBranches: ["origin/main"] }),
    );
    expect(base.ok).toBe(false);
  });

  it("still resolves when they name the SAME branch, which is one default seen twice", () => {
    const base = resolveBase(
      facts({ branch: "feature", localBranches: ["main", "feature"], remoteBranches: ["origin/main"] }),
    );
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("refuses on a detached HEAD, where there is no branch to be ahead of", () => {
    const base = resolveBase(facts({ branch: null }));
    expect(base.ok).toBe(false);
    expect(!base.ok && base.why).toMatch(/detached/i);
  });

  it("refuses when nothing resolves, rather than falling back to HEAD", () => {
    expect(resolveBase(facts({ localBranches: ["feat/x"], remoteBranches: [] })).ok).toBe(false);
  });

  it("verifies the working tree on a default branch with no remote", () => {
    // Found by running it: a repo whose only branch is `main` got "pass --range",
    // which is unhelpful and wrong. Being on the default branch is not ambiguous.
    // There is no branch to be ahead of, so the task is what is uncommitted.
    const base = resolveBase(facts({ branch: "main", localBranches: ["main"], remoteBranches: [] }));
    expect(base.ok && base.ref).toBe("HEAD");
    expect(base.ok && base.how).toMatch(/working tree|default branch/i);
  });

  it("does NOT take the working tree just because the branch is named `main`", () => {
    // Found by a cross-vendor review of this function, and it is the dangerous
    // direction: a task branch called `main` in a repo whose default is
    // `origin/master` resolved to HEAD, dropping every commit on the branch and
    // reporting a half-verified change as fully verified.
    const base = resolveBase(facts({ branch: "main", localBranches: ["main"], remoteBranches: ["origin/master"] }));
    expect(base.ok && base.ref).toBe("origin/master");
  });

  it("does the same for a task branch called `master` beside origin/main", () => {
    const base = resolveBase(facts({ branch: "master", localBranches: ["master"], remoteBranches: ["origin/main"] }));
    expect(base.ok && base.ref).toBe("origin/main");
  });

  it("does the same on `master`, and when origin/HEAD names the branch it is on", () => {
    const master = resolveBase(facts({ branch: "master", localBranches: ["master"], remoteBranches: [] }));
    expect(master.ok && master.ref).toBe("HEAD");
  });

  it("still refuses on a branch that is not a default and has no base", () => {
    // The control: `feat/x` with nothing to compare against is genuinely ambiguous,
    // and falling back to the working tree there would silently verify a fraction
    // of the task.
    expect(resolveBase(facts({ localBranches: ["feat/x"], remoteBranches: [] })).ok).toBe(false);
  });

  it("prefers origin/HEAD over a local main, since the remote is what a PR targets", () => {
    const base = resolveBase(facts({ originHead: "origin/master", localBranches: ["main", "feat/x"] }));
    expect(base.ok && base.ref).toBe("origin/master");
  });

  it("ignores an upstream that points at the branch itself", () => {
    // `git push -u origin feat/x` sets this, and it is not a base: it would compare
    // the branch to the last thing pushed and call unpushed commits the whole task.
    const base = resolveBase(facts({ upstream: "origin/feat/x", originHead: "origin/main" }));
    expect(base.ok && base.ref).toBe("origin/main");
  });
});
