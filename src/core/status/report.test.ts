import { describe, expect, it } from "vitest";
import { buildStatusReport, renderStatusReport, type StatusFacts } from "./report.js";

const base = {
  repoRoot: "/repo",
  branch: "engine-skeleton",
  sddPresent: true,
  judge: { name: "claude", version: "2.1.224" },
  nodeVersion: "v24.19.0",
  hooks: { configuredPath: ".githooks", whetstoneHooksPresent: true },
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
