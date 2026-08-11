import { describe, expect, it } from "vitest";
import { buildStatusReport, renderStatusReport, type StatusFacts } from "./report.js";

const base = {
  repoRoot: "/repo",
  branch: "engine-skeleton",
  sddPresent: true,
  judge: { name: "claude", version: "2.1.224" },
  nodeVersion: "v24.19.0",
  hooks: { configuredPath: ".githooks", whetstoneHooksPresent: true },
  plugin: {
    install: "enabled" as const,
    hookRoot: "/repo",
    hookRootIsRepo: true,
    hookRootHasSdd: true,
    sddTracked: true,
  },
};

describe("buildStatusReport", () => {
  it("is ready when the repo, .sdd/ and the judge are all present", () => {
    const r = buildStatusReport(base);
    expect(r.ready).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("is not ready outside a git repository", () => {
    const r = buildStatusReport({ ...base, repoRoot: null, branch: null });
    expect(r.ready).toBe(false);
    expect(r.problems.join(" ")).toMatch(/git repository/i);
  });

  it("is not ready without .sdd/", () => {
    const r = buildStatusReport({ ...base, sddPresent: false });
    expect(r.ready).toBe(false);
    expect(r.problems.join(" ")).toMatch(/wst init/i);
  });

  it("is not ready when the judge CLI is missing", () => {
    const r = buildStatusReport({ ...base, judge: { name: "claude", version: null } });
    expect(r.ready).toBe(false);
    expect(r.problems.join(" ")).toMatch(/claude/i);
  });

  // Drift detection: the adapter's flags were validated against a specific CLI
  // build, and `claude` auto-updates. A silent flag change must be visible.
  it("warns — but stays ready — when the judge version differs from the validated one", () => {
    const r = buildStatusReport({ ...base, judge: { name: "claude", version: "9.9.9" } });
    expect(r.ready).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/validated against/i);
  });

  it("reports every problem at once rather than only the first", () => {
    const r = buildStatusReport({
      ...base,
      sddPresent: false,
      judge: { name: "claude", version: null },
    });
    expect(r.problems).toHaveLength(2);
  });
});

describe("renderStatusReport", () => {
  it("renders without throwing and names the branch", () => {
    const text = renderStatusReport(buildStatusReport(base));
    expect(text).toContain("engine-skeleton");
    expect(text).toContain("claude");
  });

  it("in quiet mode prints only the ready line", () => {
    const text = renderStatusReport(buildStatusReport(base), { quiet: true });
    expect(text).toBe("ready");
  });

  it("in quiet mode prints only the NOT ready line, omitting problems", () => {
    const report = buildStatusReport({ ...base, sddPresent: false });
    const text = renderStatusReport(report, { quiet: true });
    expect(text).toBe("NOT ready");
  });
});

/**
 * OBSERVED IN THE FIELD (sig-0044). `plugin/hooks/gate-on-stop.mjs` exits silently on
 * every failure to RUN, and that is correct: a hook that complains about its own
 * absence on every stop is a hook people remove.
 *
 * The cost is that nothing anywhere says it is happening. In the ChytaPay install both
 * hooks were inert for the whole session, for two different reasons, and the only
 * evidence was the absence of output — which is exactly what a passing gate looks like.
 *
 * Fail-silent is right for the hook and wrong for the command whose job is to explain
 * the hook. `status` is that command, and it already holds most of the facts.
 */
describe("the plugin row", () => {
  const withPlugin = (over: Partial<StatusFacts["plugin"]>) =>
    buildStatusReport({ ...base, plugin: { ...base.plugin, ...over } });

  const row = (over: Partial<StatusFacts["plugin"]> = {}) =>
    renderStatusReport(withPlugin(over))
      .split("\n")
      .find((l) => l.trim().startsWith("plugin")) ?? "";

  it("reports the plugin alongside .sdd/, judge and pre-push", () => {
    expect(row()).not.toBe("");
  });

  it("says the hooks are active when they would actually run from here", () => {
    expect(row()).toMatch(/active|loaded/i);
    expect(withPlugin({}).warnings.join(" ")).not.toMatch(/plugin/i);
  });

  it("says the plugin is not installed rather than staying silent about it", () => {
    expect(row({ install: "absent" })).toMatch(/not installed/i);
  });

  it("distinguishes installed-but-disabled from not installed at all", () => {
    // Two different fixes. Collapsing them is the mistake `hooksInstalled` made.
    expect(row({ install: "disabled" })).not.toMatch(/not installed/i);
    expect(row({ install: "disabled" })).toMatch(/disabled/i);
    expect(withPlugin({ install: "disabled" }).warnings.join(" ")).toMatch(/plugin/i);
  });

  it("admits it could not tell rather than reporting a guess as a fact", () => {
    expect(row({ install: "unknown" })).toMatch(/unknown/i);
  });

  /**
   * Reason 1 from the field: the orchestrating session's `CLAUDE_PROJECT_DIR` was the
   * ChytaPay umbrella folder, which is not a repo and has no `.sdd/`. Both hooks were
   * inert all session and nothing said so.
   */
  it("names the directory the hooks would run in when it is not a git repository", () => {
    const r = withPlugin({ hookRoot: "/Users/x/ChytaPay", hookRootIsRepo: false });
    expect(row({ hookRoot: "/Users/x/ChytaPay", hookRootIsRepo: false })).toMatch(/inert/i);
    expect(r.warnings.join(" ")).toContain("/Users/x/ChytaPay");
    expect(r.warnings.join(" ")).toMatch(/git repository/i);
  });

  it("gives a different reason when the directory is a repo with no .sdd/", () => {
    const r = withPlugin({ hookRootHasSdd: false });
    expect(r.warnings.join(" ")).toMatch(/\.sdd/);
    expect(r.warnings.join(" ")).not.toMatch(/git repository/i);
  });

  /**
   * Reason 2, and the one that generalises worst: untracked files do not propagate
   * into git worktrees, so an UNCOMMITTED `.sdd/` silently disables the plugin in
   * every worktree — including the ones `wst run` leases. That is the posture of
   * anyone trialling Whetstone before proposing it to their team.
   */
  it("warns that an untracked .sdd/ leaves the plugin inert in every worktree", () => {
    const r = withPlugin({ sddTracked: false });
    expect(r.warnings.join(" ")).toMatch(/worktree/i);
    expect(r.warnings.join(" ")).toMatch(/untracked|commit/i);
  });

  it("does not raise the worktree warning once .sdd/ is tracked", () => {
    expect(withPlugin({ sddTracked: true }).warnings.join(" ")).not.toMatch(/worktree/i);
  });

  it("says nothing about inertness when the plugin is not installed to be inert", () => {
    // Nothing is broken about a repo that never adopted the plugin. Reporting the
    // hook's would-be root as a problem there is noise, and noise is what gets muted.
    const r = withPlugin({ install: "absent", hookRootIsRepo: false, sddTracked: false });
    expect(r.warnings.join(" ")).not.toMatch(/inert/i);
    expect(r.warnings.join(" ")).not.toMatch(/worktree/i);
  });

  it("stays a warning, never a problem, in every plugin state", () => {
    // Same reasoning as the pre-push row: an unadopted optional hook is not a broken
    // repo, and `ready` has to keep meaning what it meant.
    for (const install of ["enabled", "disabled", "absent", "unknown"] as const) {
      for (const hookRootIsRepo of [true, false]) {
        const r = withPlugin({ install, hookRootIsRepo, sddTracked: false });
        expect(r.problems.join(" ")).not.toMatch(/plugin/i);
        expect(r.ready).toBe(true);
      }
    }
  });

  it("keeps quiet mode to the ready line", () => {
    const text = renderStatusReport(withPlugin({ install: "absent" }), { quiet: true });
    expect(text).toBe("ready");
  });
});

describe("the pre-push gate", () => {
  const withHooks = (over: Partial<StatusFacts["hooks"]>) =>
    buildStatusReport({ ...base, hooks: { ...base.hooks, ...over } });

  // A gate that only runs when someone remembers to type it will be forgotten.
  // Reporting an unarmed clone as drift is the difference between a gate that is
  // available and one that is actually in the path.
  it("warns when nothing is configured and .githooks/ is there to point at", () => {
    const r = withHooks({ configuredPath: null });
    expect(r.ready).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/core\.hooksPath/);
  });

  it("says nothing when the hook is active", () => {
    expect(buildStatusReport(base).warnings.join(" ")).not.toMatch(/hooksPath/);
  });

  /**
   * THE ADVICE MUST NOT BE DESTRUCTIVE.
   *
   * git has ONE `core.hooksPath`, so husky, lefthook and Whetstone are mutually
   * exclusive. Telling someone on `.husky` to run `git config core.hooksPath
   * .githooks` disarms their existing hooks — and `wst init` never writes a
   * `.githooks/` directory, so it disarms them and installs nothing in its place.
   * A boolean `hooksInstalled` could not tell those states apart: a repo on
   * `.husky` reported identically to a repo with no hooks at all.
   */
  it("does NOT tell you to overwrite another tool's hooksPath", () => {
    const r = withHooks({ configuredPath: ".husky" });
    expect(r.warnings.join(" ")).not.toMatch(/run `git config/);
  });

  it("names the tool that currently owns hooks so the conflict is legible", () => {
    expect(withHooks({ configuredPath: ".husky" }).warnings.join(" ")).toMatch(/\.husky/);
  });

  it("refuses to suggest pointing git at a .githooks/ that does not exist", () => {
    // Following that advice disarms whatever was there and installs nothing.
    const r = withHooks({ configuredPath: null, whetstoneHooksPresent: false });
    expect(r.warnings.join(" ")).not.toMatch(/run `git config/);
  });

  it("stays a warning, never a problem, in every hook state", () => {
    for (const configuredPath of [null, ".husky", ".githooks"]) {
      for (const whetstoneHooksPresent of [true, false]) {
        const r = withHooks({ configuredPath, whetstoneHooksPresent });
        expect(r.problems.join(" ")).not.toMatch(/hook/i);
      }
    }
  });
});
