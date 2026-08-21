import { describe, expect, it } from "vitest";
import { buildRegistry, parseCheckFile } from "./registry.js";

const FILE = `---
id: typecheck
description: TypeScript must compile.
kind: deterministic
severity: block
tiers: [strict, light]
include: ["src/**/*.ts"]
command: npm run typecheck
origin: [adr-0008]
version: 1
---

Run \`npm run typecheck\`. If it fails, the types are wrong — do not suppress with \`any\`.
`;

describe("parseCheckFile", () => {
  it("splits frontmatter from body and validates", () => {
    const check = parseCheckFile("typecheck.md", FILE);
    expect(check.id).toBe("typecheck");
    expect(check.severity).toBe("block");
    expect(check.body).toMatch(/do not suppress/);
  });

  it("requires the id to match the filename", () => {
    // Otherwise a file rename silently orphans every receipt and origin
    // reference that points at the old id.
    expect(() => parseCheckFile("other.md", FILE)).toThrow(/filename/i);
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseCheckFile("x.md", "no frontmatter here")).toThrow(/frontmatter/i);
  });

  it("throws on malformed YAML rather than half-loading", () => {
    expect(() => parseCheckFile("x.md", "---\nid: [unclosed\n---\nbody")).toThrow();
  });

  it("reports the file name in a validation error", () => {
    const bad = FILE.replace("severity: block", "severity: nag");
    expect(() => parseCheckFile("typecheck.md", bad)).toThrow(/typecheck\.md/);
  });
});

const check = (over: Record<string, unknown> = {}) => ({
  id: "a",
  description: "d",
  kind: "deterministic" as const,
  severity: "block" as const,
  tiers: ["strict" as const],
  include: ["**/*.ts"],
  exclude: [],
  command: "true",
  origin: [],
  version: 1,
  enabled: true,
  skippable: true,
  body: "",
  ...over,
});

describe("buildRegistry", () => {
  it("indexes checks by id", () => {
    const r = buildRegistry([check({ id: "a" }), check({ id: "b" })]);
    expect(r.byId.get("a")?.description).toBe("d");
    expect(r.all).toHaveLength(2);
  });

  it("rejects duplicate ids", () => {
    expect(() => buildRegistry([check({ id: "a" }), check({ id: "a" })])).toThrow(/duplicate/i);
  });

  it("separates disabled checks so they never run but stay visible", () => {
    const r = buildRegistry([check({ id: "a" }), check({ id: "b", enabled: false })]);
    expect(r.active).toHaveLength(1);
    expect(r.all).toHaveLength(2);
  });

  it("compiles a stable, sorted index", () => {
    const one = buildRegistry([check({ id: "b" }), check({ id: "a" })]).index;
    const two = buildRegistry([check({ id: "a" }), check({ id: "b" })]).index;
    expect(one).toEqual(two);
    expect(one.checks.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("keeps the body out of the compiled index", () => {
    // The index is a lookup table; bodies are prose for humans and would
    // bloat every consumer that only needs to know what runs.
    const { index } = buildRegistry([check({ body: "long prose" })]);
    expect(JSON.stringify(index)).not.toContain("long prose");
  });

  it("counts what may block, for the gate to report", () => {
    const r = buildRegistry([
      check({ id: "a", severity: "block" }),
      check({ id: "b", severity: "warn" }),
      check({ id: "c", severity: "block", enabled: false }),
    ]);
    expect(r.index.blocking).toEqual(["a"]);
  });
});
