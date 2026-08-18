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

  /**
   * The block rule is NOT here any more, and that is the point.
   *
   * It used to live in this schema and ask one question: does the YAML say
   * `status: passed`? Two hand-typed fields, and editing three lines of a check file
   * promoted an unmeasured lens to blocking authority — demonstrated, not feared.
   *
   * A zod schema sees one file's text. It cannot hash a fixture directory, so it can
   * never tell a measurement from a claim about one. The rule moved to
   * `parseCheckFile`, which is handed the receipt; see `registry.test.ts`. Leaving a
   * weaker copy here would be two authorities that can disagree.
   */
  it("no longer decides whether an agent-lens may block", () => {
    // Parses fine. Whether it LOADS is the registry's call, with evidence in hand.
    expect(CheckSchema.safeParse({ ...agentLens, severity: "block" }).success).toBe(true);
  });

  it("rejects the `status` field outright, so an old check file fails loudly", () => {
    // Silently ignoring it would leave repos carrying a field that reads like it
    // still grants something.
    const r = CheckSchema.safeParse({
      ...agentLens,
      calibration: { status: "passed", runs: 10, date: "2026-08-07" },
    });
    expect(r.success).toBe(false);
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

/**
 * adr-0018: a verification method is a third kind.
 *
 * Some verification is not a command and not a diff review. The case that
 * produced this: drive a browser, take the screenshots, compare them against the
 * intended design. A deterministic check reduces to an exit code and there is no
 * exit code for "the empty state looks wrong"; an agent-lens reads a diff and a
 * screenshot is not in one.
 *
 * The schema is where the never-blocks rule lives, for the same reason
 * non-negotiable 2 lives here: a rule enforced at parse time cannot be forgotten
 * by the next person who writes a check file.
 */
describe("a method check", () => {
  const method = (over: Record<string, unknown> = {}) => ({
    id: "ui-states",
    description: "Drive the three states and compare them against the design.",
    kind: "method",
    severity: "annotate",
    tiers: ["strict"],
    include: ["src/ui/**"],
    version: 1,
    ...over,
  });

  it("parses without a command, because a method is prose an agent follows", () => {
    expect(CheckSchema.safeParse(method()).success).toBe(true);
  });

  it("refuses to block, at parse time", () => {
    // The gate cannot enforce it — a method's outcome is a human's judgment or an
    // agent's report — so a method claiming `block` would be a promise nothing
    // keeps. Rejected by the schema rather than remembered by a reviewer.
    const result = CheckSchema.safeParse(method({ severity: "block" }));

    expect(result.success).toBe(false);
    if (!result.success) expect(JSON.stringify(result.error.issues)).toMatch(/method/i);
  });

  it("refuses to block even at warn, which is still a verdict it cannot produce", () => {
    expect(CheckSchema.safeParse(method({ severity: "warn" })).success).toBe(false);
  });

  it("refuses a command, which would make it a deterministic check wearing a name", () => {
    expect(CheckSchema.safeParse(method({ command: "npm run e2e" })).success).toBe(false);
  });

  it("refuses a review_lens for the same reason", () => {
    expect(CheckSchema.safeParse(method({ review_lens: "look at it" })).success).toBe(false);
  });
});
