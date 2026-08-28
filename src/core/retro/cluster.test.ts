import { describe, expect, it } from "vitest";
import { clusterSignals, signalsSince, unresolved, type Signal } from "./cluster.js";

const sig = (over: Partial<Signal> & { id: string }): Signal => ({
  ts: "2026-08-08T00:00:00-03:00",
  type: "generic",
  phase: "apply",
  severity: "medium",
  detail: "something happened",
  rule_affected: [],
  ...over,
});

describe("signalsSince", () => {
  it("returns everything when there is no cursor", () => {
    const all = [sig({ id: "sig-0001" }), sig({ id: "sig-0002" })];
    expect(signalsSince(all, null)).toHaveLength(2);
  });

  it("returns only signals AFTER the cursor", () => {
    const all = [sig({ id: "sig-0001" }), sig({ id: "sig-0002" }), sig({ id: "sig-0003" })];
    expect(signalsSince(all, "sig-0001").map((s) => s.id)).toEqual(["sig-0002", "sig-0003"]);
  });

  it("returns nothing when the cursor is the last signal", () => {
    expect(signalsSince([sig({ id: "sig-0001" })], "sig-0001")).toEqual([]);
  });

  // A cursor naming a signal that does not exist means the log was edited or the
  // cursor is corrupt. Silently treating everything as new would re-propose rules
  // that were already accepted or already rejected.
  it("throws when the cursor names a signal that is not in the log", () => {
    expect(() => signalsSince([sig({ id: "sig-0002" })], "sig-0999")).toThrow(/cursor/i);
  });
});

describe("clusterSignals", () => {
  it("groups by rule_affected — the strongest signal", () => {
    const clusters = clusterSignals([
      sig({ id: "a", rule_affected: ["skills/voice.md"] }),
      sig({ id: "b", rule_affected: ["skills/voice.md"] }),
      sig({ id: "c", rule_affected: ["skills/lazy.md"] }),
    ]);
    const voice = clusters.find((c) => c.key === "rule:skills/voice.md");
    expect(voice?.signals.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("groups by type when a rule is not named", () => {
    const clusters = clusterSignals([
      sig({ id: "a", type: "triage-miss" }),
      sig({ id: "b", type: "triage-miss" }),
    ]);
    expect(clusters.some((c) => c.key === "type:triage-miss" && c.signals.length === 2)).toBe(true);
  });

  it("counts a signal in every cluster it belongs to", () => {
    // One signal can implicate two skills; forcing it into one bucket loses the
    // evidence that makes the second cluster actionable.
    const clusters = clusterSignals([
      sig({ id: "a", rule_affected: ["skills/voice.md", "skills/lazy.md"] }),
    ]);
    expect(clusters.filter((c) => c.key.startsWith("rule:"))).toHaveLength(2);
  });

  // §2: recurrence is the trigger — EXCEPT a single high-severity signal is a
  // candidate on its own. Waiting for a `high` to recur means waiting for it to
  // happen twice, which is the thing the retro exists to prevent.
  it("marks a cluster of two or more as actionable", () => {
    const clusters = clusterSignals([
      sig({ id: "a", type: "t" }),
      sig({ id: "b", type: "t" }),
    ]);
    expect(clusters.find((c) => c.key === "type:t")?.actionable).toBe(true);
  });

  it("marks a LONE high-severity signal actionable on its own", () => {
    const clusters = clusterSignals([sig({ id: "a", type: "t", severity: "high" })]);
    expect(clusters.find((c) => c.key === "type:t")?.actionable).toBe(true);
  });

  it("does NOT mark a lone low-severity signal actionable", () => {
    const clusters = clusterSignals([sig({ id: "a", type: "t", severity: "low" })]);
    expect(clusters.find((c) => c.key === "type:t")?.actionable).toBe(false);
  });

  it("orders clusters by strength so the human reads the best evidence first", () => {
    const clusters = clusterSignals([
      sig({ id: "a", type: "weak" }),
      sig({ id: "b", type: "strong", rule_affected: ["skills/x.md"] }),
      sig({ id: "c", type: "strong", rule_affected: ["skills/x.md"] }),
      sig({ id: "d", type: "strong", rule_affected: ["skills/x.md"] }),
    ]);
    expect(clusters[0]?.signals.length).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing for no signals rather than inventing a cluster", () => {
    expect(clusterSignals([])).toEqual([]);
  });
});

describe("clusterSignals — subsumption", () => {
  it("drops a cluster whose signals are all inside a stronger one", () => {
    // sig a+b both name a rule AND share a type. Without this, the retro pays for
    // two proposals over the same evidence and hands the human a duplicate.
    const clusters = clusterSignals([
      sig({ id: "a", type: "t", rule_affected: ["skills/x.md"] }),
      sig({ id: "b", type: "t", rule_affected: ["skills/x.md"] }),
    ]);
    expect(clusters.map((c) => c.key)).toEqual(["rule:skills/x.md"]);
  });

  it("keeps a type cluster that carries signals the rule cluster does not", () => {
    const clusters = clusterSignals([
      sig({ id: "a", type: "t", rule_affected: ["skills/x.md"] }),
      sig({ id: "b", type: "t" }),
    ]);
    expect(clusters.map((c) => c.key)).toContain("type:t");
  });

  it("a rule cluster is NEVER subsumed by a broad type bucket", () => {
    // The failure this guards: a catch-all `type:generic` carrying every signal
    // swallowed the rule clusters that are the whole point of clustering.
    const clusters = clusterSignals([
      sig({ id: "a", rule_affected: ["skills/voice.md"] }),
      sig({ id: "b", rule_affected: ["skills/voice.md"] }),
      sig({ id: "c", rule_affected: ["skills/lazy.md"] }),
    ]);
    expect(clusters.map((c) => c.key)).toContain("rule:skills/voice.md");
    expect(clusters.map((c) => c.key)).toContain("rule:skills/lazy.md");
    // type:generic survives here, and should: it spans BOTH rules, so no single
    // rule cluster covers it. That is a candidate meta-pattern, not a duplicate.
    expect(clusters.find((c) => c.key === "type:generic")?.signals).toHaveLength(3);
  });
});

describe("unresolved", () => {
  // retro-0005 spent $0.2994 on five proposals; three re-proposed work already done.
  it("drops a signal that already records what answered it", () => {
    const kept = unresolved([
      sig({ id: "a" }),
      sig({ id: "b", resolved_by: "skills/voice.md@v3" }),
    ]);
    expect(kept.map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps everything when nothing is resolved", () => {
    expect(unresolved([sig({ id: "a" }), sig({ id: "b" })])).toHaveLength(2);
  });

  // Recurrence makes a cluster actionable, so a fixed signal may not be half of it.
  it("leaves a pair with one answered half short of recurrence", () => {
    const open = unresolved([
      sig({ id: "a", type: "t" }),
      sig({ id: "b", type: "t", resolved_by: "pr-107" }),
    ]);
    expect(clusterSignals(open).find((c) => c.key === "type:t")?.actionable).toBe(false);
  });
});
