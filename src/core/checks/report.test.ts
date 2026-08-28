import { describe, expect, it } from "vitest";
import type { LoadedCheck } from "./registry.js";
import { renderRegistry } from "./report.js";

const check = (over: Partial<LoadedCheck> = {}): LoadedCheck =>
  ({
    id: "test",
    description: "The test suite passes.",
    kind: "deterministic",
    severity: "block",
    tiers: ["strict", "light"],
    include: ["src/**"],
    exclude: [],
    enabled: true,
    skippable: true,
    origin: [],
    version: 1,
    body: "",
    ...over,
  }) as LoadedCheck;

const page = (checks: readonly LoadedCheck[]) =>
  renderRegistry({ definitionDir: ".wst", checks }).join("\n");

describe("renderRegistry", () => {
  it("says nothing about what may block when every enabled check does", () => {
    // The column already said BLOCK on each row. Repeating the same nine ids
    // underneath is one fact stated ten times.
    const text = page([check({ id: "a" }), check({ id: "b" })]);

    expect(text).not.toMatch(/may block/);
  });

  it("names them when only some may block, which is when the line informs", () => {
    const text = page([check({ id: "a" }), check({ id: "b", severity: "warn" })]);

    expect(text).toMatch(/may block: a$/m);
  });

  it("counts a disabled check as present and not as active", () => {
    const text = page([check({ id: "a" }), check({ id: "b", enabled: false })]);

    expect(text).toMatch(/1 active of 2/);
    expect(text).toMatch(/off {2}/);
  });

  it("does not count a disabled blocking check toward what may block", () => {
    // It cannot block anything: it does not run.
    const text = page([check({ id: "a" }), check({ id: "b", enabled: false })]);

    expect(text).not.toMatch(/may block/);
  });

  it("keeps every line inside a default terminal, however long a description", () => {
    const text = page([check({ description: "x".repeat(400) })]);

    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("tells a method from a check the gate runs, which is the load-bearing column", () => {
    const text = page([check({ id: "a", kind: "method" }), check({ id: "b", kind: "llm" })]);

    expect(text).toMatch(/meth/);
    expect(text).toMatch(/llm/);
  });

  it("says where to put one rather than printing an empty table", () => {
    expect(page([])).toMatch(/add files under \.wst\/checks/);
  });
});
