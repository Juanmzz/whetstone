import { describe, expect, it } from "vitest";
import { readForeignFindings } from "./foreign.js";

const ONE = JSON.stringify({
  type: "duplicate-logic",
  phase: "review",
  severity: "medium",
  detail: "Two implementations of the receipt hash drifted, and only one is tested.",
  rule_affected: ["skills/lazy.md"],
});

describe("readForeignFindings", () => {
  it("reads one finding", () => {
    const read = readForeignFindings(`[${ONE}]`);

    expect(read.ok).toBe(true);
    expect(read.ok && read.findings).toHaveLength(1);
    expect(read.ok && read.findings[0]?.type).toBe("duplicate-logic");
  });

  it("reads a bare object as a list of one, because tools emit both", () => {
    expect(readForeignFindings(ONE).ok).toBe(true);
  });

  it("reads NDJSON, one object per line", () => {
    const read = readForeignFindings(`${ONE}\n${ONE}`);

    expect(read.ok && read.findings).toHaveLength(2);
  });

  it("finds a list nested under the key a tool happened to choose", () => {
    // roborev returns `{findings: [...]}`, others `{results: [...]}`. Requiring a
    // top-level array means every tool needs a jq incantation first.
    expect(readForeignFindings(`{"findings":[${ONE}]}`).ok).toBe(true);
    expect(readForeignFindings(`{"results":[${ONE}]}`).ok).toBe(true);
  });

  it("refuses the whole file when one finding is malformed", () => {
    // Append-only: half a batch written is a log nobody can reconcile, and the
    // fix cannot be an edit.
    const bad = JSON.stringify({ type: "NotKebab", phase: "review", severity: "medium", detail: "x".repeat(30) });
    const read = readForeignFindings(`[${ONE},${bad}]`);

    expect(read.ok).toBe(false);
    expect(read.ok === false && read.errors.join(" ")).toMatch(/kebab/i);
  });

  it("says which entry was wrong, not just that one was", () => {
    const bad = JSON.stringify({ type: "ok-type", phase: "", severity: "medium", detail: "x".repeat(30) });
    const read = readForeignFindings(`[${ONE},${bad}]`);

    expect(read.ok === false && read.errors.join(" ")).toMatch(/\b2\b/);
  });

  it("refuses text that is not JSON at all", () => {
    expect(readForeignFindings("not json").ok).toBe(false);
    expect(readForeignFindings("").ok).toBe(false);
  });

  it("refuses an empty batch rather than reporting a successful nothing", () => {
    expect(readForeignFindings("[]").ok).toBe(false);
  });

  it("carries the tool's own name into the detail, so the log says where it came from", () => {
    const read = readForeignFindings(`[${ONE}]`, "roborev");

    expect(read.ok && read.findings[0]?.detail).toMatch(/roborev/);
  });
});
