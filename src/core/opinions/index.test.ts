import { describe, expect, it } from "vitest";
import { OPINIONS, opinionById } from "./index.js";

describe("the opinion catalogue", () => {
  it("never names a script the target repo would have to already have", () => {
    // The blocker adr-0025 hit: `npm run check:comments` names nothing in a repo
    // Whetstone did not write, so the seeded check fails on every run.
    for (const o of OPINIONS) {
      expect(o.command.startsWith("wst ")).toBe(true);
      expect(o.command).not.toContain("npm run");
    }
  });

  it("carries the friction that earned it, which is what the question asks about", () => {
    for (const o of OPINIONS) {
      expect(o.friction.length).toBeGreaterThan(40);
      expect(o.origin.length).toBeGreaterThan(0);
    }
  });

  it("cites no decision id, which resolves to nothing in a bootstrapped repo", () => {
    // ADR-0004. A signal id is a label beside its own description and survives;
    // a decision id is a pointer a reader is expected to follow, and it dangles.
    for (const o of OPINIONS) {
      for (const ref of o.origin) expect(ref).not.toMatch(/^adr-/i);
      expect(o.body).not.toMatch(/\badr-\d{4}\b/i);
    }
  });

  it("uses no em-dash, same as every other page init writes into a target repo", () => {
    for (const o of OPINIONS) expect(`${o.title}${o.friction}${o.body}`).not.toContain("—");
  });

  it("answers with null for an id nobody ships, rather than throwing at a caller", () => {
    expect(opinionById("nope")).toBeNull();
  });
});
