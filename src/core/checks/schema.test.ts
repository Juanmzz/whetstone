import { describe, expect, it } from "vitest";
import { CheckSchema } from "./schema.js";

const deterministic = {
  id: "typecheck",
  description: "TypeScript must compile with no errors.",
  kind: "deterministic",
  severity: "block",
  tiers: ["strict", "light"],
  include: ["src/**/*.ts"],
  command: "npm run typecheck",
  origin: ["adr-0008"],
  version: 1,
};

const agentLens = {
  id: "correctness",
  description: "Does this diff introduce a correctness bug?",
  kind: "agent-lens",
  severity: "warn",
  tiers: ["strict"],
  include: ["src/**/*.ts"],
  review_lens: "You are a correctness review lens.",
  origin: ["adr-0008"],
  version: 1,
};

describe("CheckSchema", () => {
  it("accepts a well-formed deterministic check", () => {
    const r = CheckSchema.safeParse(deterministic);
    expect(r.success).toBe(true);
  });

  it("defaults enabled to true", () => {
    const r = CheckSchema.parse(deterministic);
    expect(r.enabled).toBe(true);
  });

  it("requires a kebab-case id", () => {
    expect(CheckSchema.safeParse({ ...deterministic, id: "Type Check" }).success).toBe(false);
  });

  it("rejects an unknown severity", () => {
    expect(CheckSchema.safeParse({ ...deterministic, severity: "nag" }).success).toBe(false);
  });

  it("rejects unknown keys instead of ignoring them", () => {
    // A typo'd field that is silently dropped is a check that quietly does
    // something other than what its author wrote.
    const r = CheckSchema.safeParse({ ...deterministic, sevrity: "warn" });
    expect(r.success).toBe(false);
  });

  it("requires a command when the check is deterministic", () => {
    const { command: _drop, ...noCommand } = deterministic;
    const r = CheckSchema.safeParse(noCommand);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.message).toMatch(/command/i);
  });

  it("requires a review_lens when the check is agent-lens", () => {
    const { review_lens: _drop, ...noLens } = agentLens;
    const r = CheckSchema.safeParse(noLens);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.message).toMatch(/review_lens/i);
  });

  it("rejects a deterministic check that also declares a review_lens", () => {
    const r = CheckSchema.safeParse({ ...deterministic, review_lens: "confused" });
    expect(r.success).toBe(false);
  });

  // ── Constitution non-negotiable 7, enforced at parse time ────────────────
  // The registry itself refuses to load a flaky blocking check. Making this a
  // schema rule rather than a runtime check means it cannot be forgotten.

  it("lets an agent-lens check WARN without any calibration", () => {
    expect(CheckSchema.safeParse(agentLens).success).toBe(true);
  });

  it("REFUSES an agent-lens check that blocks without calibration", () => {
    const r = CheckSchema.safeParse({ ...agentLens, severity: "block" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.message).toMatch(/calibrat/i);
  });

  it("REFUSES an agent-lens check that blocks on FAILED calibration", () => {
    const r = CheckSchema.safeParse({
      ...agentLens,
      severity: "block",
      calibration: { status: "failed", runs: 10, date: "2026-08-07" },
    });
    expect(r.success).toBe(false);
  });

  it("allows an agent-lens check to block once calibration passed", () => {
    const r = CheckSchema.safeParse({
      ...agentLens,
      severity: "block",
      calibration: { status: "passed", runs: 10, date: "2026-08-07" },
    });
    expect(r.success).toBe(true);
  });

  it("lets a DETERMINISTIC check block freely — no calibration needed", () => {
    expect(CheckSchema.safeParse({ ...deterministic, severity: "block" }).success).toBe(true);
  });

  it("rejects calibration claiming to pass with zero runs", () => {
    const r = CheckSchema.safeParse({
      ...agentLens,
      severity: "block",
      calibration: { status: "passed", runs: 0, date: "2026-08-07" },
    });
    expect(r.success).toBe(false);
  });
});
