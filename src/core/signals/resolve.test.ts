import { describe, expect, it } from "vitest";
import { markResolved } from "./resolve.js";
import { parseSignalLog } from "./parse.js";

const line = (over: Record<string, unknown> & { id: string }): string =>
  JSON.stringify({
    ts: "2026-08-25T19:20:57.697Z",
    type: "calibration-deadlock",
    phase: "verify",
    severity: "medium",
    detail: "something happened",
    ...over,
  });

const log = (...lines: string[]): string => `${lines.join("\n")}\n`;

describe("markResolved", () => {
  it("sets resolved_by on the named line", () => {
    const result = markResolved(log(line({ id: "sig-0001" }), line({ id: "sig-0002" })), "sig-0002", "pr-107");
    if (!result.ok) throw new Error(result.error);
    const records = parseSignalLog(result.text);
    expect(records[1]?.resolved_by).toBe("pr-107");
  });

  // Rewriting the file to answer one line is only defensible if the rest survives.
  it("leaves every other line byte-for-byte", () => {
    const before = log(line({ id: "sig-0001" }), line({ id: "sig-0002" }));
    const result = markResolved(before, "sig-0002", "pr-107");
    if (!result.ok) throw new Error(result.error);
    expect(result.text.split("\n")[0]).toBe(before.split("\n")[0]);
    expect(result.text.endsWith("\n")).toBe(true);
  });

  it("appends the field without dropping or reordering what was there", () => {
    const before = line({ id: "sig-0001", branch: "feat/x", rule_affected: ["skills/voice.md"] });
    const result = markResolved(log(before), "sig-0001", "skills/voice.md@v3");
    if (!result.ok) throw new Error(result.error);
    expect(result.text.trim()).toBe(
      before.slice(0, -1) + `,"resolved_by":"skills/voice.md@v3"}`,
    );
  });

  it("refuses an id the log does not carry", () => {
    const result = markResolved(log(line({ id: "sig-0001" })), "sig-9999", "pr-107");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sig-9999/);
  });

  // Overwriting a recorded answer is a CORRECTION, and [RC6] makes that a new entry.
  it("refuses to overwrite an answer already recorded", () => {
    const result = markResolved(
      log(line({ id: "sig-0001", resolved_by: "skills/voice.md@v2" })),
      "sig-0001",
      "pr-107",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/skills\/voice\.md@v2/);
  });

  it("refuses an empty answer, which records nothing while looking like a record", () => {
    expect(markResolved(log(line({ id: "sig-0001" })), "sig-0001", "  ").ok).toBe(false);
  });

  it("throws on a corrupt log rather than rewriting it", () => {
    expect(() => markResolved(`${line({ id: "sig-0001" })}\nnot json\n`, "sig-0001", "pr-107")).toThrow();
  });
});
