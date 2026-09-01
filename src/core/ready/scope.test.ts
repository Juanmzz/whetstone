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

  it("refuses on a detached HEAD, where there is no branch to be ahead of", () => {
    const base = resolveBase(facts({ branch: null }));
    expect(base.ok).toBe(false);
    expect(!base.ok && base.why).toMatch(/detached/i);
  });

  it("refuses when nothing resolves, rather than falling back to HEAD", () => {
    expect(resolveBase(facts({ localBranches: ["feat/x"], remoteBranches: [] })).ok).toBe(false);
  });

  it("does not take the branch it is standing on as its own base", () => {
    // A branch literally called `main` has no base among the candidates; saying
    // `main..main` would report an empty change as verified.
    const base = resolveBase(facts({ branch: "main", localBranches: ["main"], remoteBranches: [] }));
    expect(base.ok).toBe(false);
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
