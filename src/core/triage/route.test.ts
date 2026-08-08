import { describe, expect, it } from "vitest";
import { TIERS, type Check, type Tier } from "../checks/schema.js";
import { route } from "./route.js";

const check = (id: string, tiers: readonly Tier[], enabled = true): Check => ({
  id,
  description: `the ${id} check`,
  kind: "deterministic",
  command: "true",
  severity: "block",
  tiers: [...tiers],
  include: ["src/**/*.ts"],
  exclude: [],
  enabled,
  version: 1,
  origin: [],
});

const REGISTRY: readonly Check[] = [
  check("correctness", ["strict"]),
  check("test", ["strict", "light"]),
  check("typecheck", ["strict", "light"]),
  check("legacy", ["strict", "light", "off"], false),
];

describe("route — check selection", () => {
  it("selects the checks that declare this tier", () => {
    expect(route("strict", REGISTRY).checks).toEqual(["correctness", "test", "typecheck"]);
    expect(route("light", REGISTRY).checks).toEqual(["test", "typecheck"]);
  });

  it("omits a check that does not declare this tier", () => {
    expect(route("light", REGISTRY).checks).not.toContain("correctness");
  });

  it("omits a DISABLED check even when its tiers match", () => {
    // `enabled: false` is the kill switch. If routing ignored it, the only way to
    // turn a check off would be to delete it, and its history with it.
    expect(route("off", REGISTRY).checks).toEqual([]);
    expect(route("strict", REGISTRY).checks).not.toContain("legacy");
  });

  it("returns an empty selection for an empty registry", () => {
    expect(route("strict", []).checks).toEqual([]);
  });

  it("preserves the registry's order rather than re-sorting", () => {
    // The registry is already sorted by id; re-sorting here would be a second,
    // silently divergent opinion about ordering.
    const reversed = [...REGISTRY].reverse();
    expect(route("light", reversed).checks).toEqual(["typecheck", "test"]);
  });

  it("echoes the tier it routed, so a Routing is self-describing", () => {
    for (const tier of TIERS) expect(route(tier, REGISTRY).tier).toBe(tier);
  });
});

/**
 * THE PRINCIPLE THIS SECTION EXISTS TO PROTECT: autonomy is INVERSE to criticality.
 *
 * The most consequential changes keep a human in the loop and are never patched
 * up automatically; the trivial ones are handed to the cheapest model and left
 * alone. Inverting either half is how an autonomous agent quietly "fixes" the
 * engine that decides whether its own work is acceptable.
 */
describe("route — autonomy is inverse to criticality", () => {
  it("routes strict to a human gate, on opus, with autofix OFF", () => {
    const routing = route("strict", REGISTRY);
    expect(routing.autonomy).toBe("human-gate");
    expect(routing.modelTier).toBe("opus");
    expect(routing.autofix).toBe(false);
  });

  it("routes light to autonomous, on sonnet, with autofix on", () => {
    const routing = route("light", REGISTRY);
    expect(routing.autonomy).toBe("autonomous");
    expect(routing.modelTier).toBe("sonnet");
    expect(routing.autofix).toBe(true);
  });

  it("routes off to autonomous, on haiku, with autofix on", () => {
    const routing = route("off", REGISTRY);
    expect(routing.autonomy).toBe("autonomous");
    expect(routing.modelTier).toBe("haiku");
    expect(routing.autofix).toBe(true);
  });

  it("never auto-fixes anything held at a human gate", () => {
    // Stated as a property over every tier, so adding a fourth tier that gates a
    // human AND autofixes fails here rather than in production.
    for (const tier of TIERS) {
      const routing = route(tier, REGISTRY);
      if (routing.autonomy === "human-gate") expect(routing.autofix).toBe(false);
    }
  });

  it("gates a human on exactly the strict tier", () => {
    const gated = TIERS.filter((t) => route(t, REGISTRY).autonomy === "human-gate");
    expect(gated).toEqual(["strict"]);
  });

  it("spends the most capable model on the most critical tier", () => {
    const rank = { haiku: 0, sonnet: 1, opus: 2 } as const;
    expect(rank[route("strict", REGISTRY).modelTier]).toBeGreaterThan(
      rank[route("light", REGISTRY).modelTier],
    );
    expect(rank[route("light", REGISTRY).modelTier]).toBeGreaterThan(
      rank[route("off", REGISTRY).modelTier],
    );
  });

  it("gives every tier a routing policy", () => {
    // A tier with no entry must not silently fall through to a permissive default.
    for (const tier of TIERS) {
      const routing = route(tier, REGISTRY);
      expect(routing.autonomy).toBeDefined();
      expect(routing.modelTier).toBeDefined();
      expect(typeof routing.autofix).toBe("boolean");
    }
  });
});
