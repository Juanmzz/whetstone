import { describe, expect, it } from "vitest";
import { laneReport } from "./lane.js";

describe("laneReport — what prepare may claim about a lane", () => {
  it("claims enforcement only when a guard is actually there", () => {
    expect(laneReport("triage", true)).toBe("triage (enforced by the lane guard)");
  });

  it("says the boundary is on the charter's word when nothing enforces it", () => {
    // Observed twice in real use: a worker edited outside its lane, saw nothing
    // stop it, reverted, and asked. It obeyed the text. The charter had promised
    // a hook, and the promise was the defect — a charter that names a barrier
    // that is not there reads as authoritative and is wrong.
    const report = laneReport("api", false);

    expect(report).toContain("api");
    expect(report).not.toMatch(/\benforced by\b/);
    expect(report).toMatch(/not enforced here|charter/i);
  });

  it("says nothing at all when no lane was asked for", () => {
    expect(laneReport(null, false)).toBeNull();
  });
});
