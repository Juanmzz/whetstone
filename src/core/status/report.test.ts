import { describe, expect, it } from "vitest";
import { buildStatusReport, renderStatusReport } from "./report.js";

const base = {
  repoRoot: "/repo",
  branch: "engine-skeleton",
  sddPresent: true,
  judge: { name: "claude", version: "2.1.224" },
  nodeVersion: "v24.19.0",
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
