import { describe, expect, it } from "vitest";
import { edgesOf, contradictionsIn } from "./edges.js";

const SIGNALS = [
  '{"id":"sig-0002","type":"x","detail":"d","rule_affected":["skills/token-economy.md"]}',
  '{"id":"sig-0009","type":"x","detail":"d","rule_affected":[]}',
].join("\n");

const SKILLS = {
  "skills/lazy.md": "Five entries: `sig-0002` (the emitter wrote both files identical).",
  "skills/token-economy.md": "No citation here.",
};

const CHECKS = { "checks/skill-shape.md": "origin: [adr-0007]\n" };

const DECISIONS = [
  "### adr-0007 — amends by status",
  "`superseded by adr-0019` · 2026-07-14",
  "",
  "### adr-0019 — the record may be compacted",
  "`accepted` · 2026-08-14",
].join("\n");

const world = () => ({ signals: SIGNALS, skills: SKILLS, checks: CHECKS, decisions: DECISIONS });

describe("edgesOf — every relationship the files already declare", () => {
  it("reads signal → rule off the signal's own field", () => {
    const found = edgesOf(world()).filter((e) => e.kind === "signal-affects-rule");

    expect(found).toContainEqual({
      kind: "signal-affects-rule",
      from: "sig-0002",
      to: "skills/token-economy.md",
      sourceDoc: ".wst/memory/signals.jsonl",
    });
  });

  it("reads rule → signal off the skill's prose, and records which file said so", () => {
    const [found] = edgesOf(world()).filter((e) => e.kind === "rule-mentions-signal");

    // `source_doc` is the field the graph-memory-starter schema carries on every
    // relation. It is what makes two documents disagreeing about one relationship
    // a nameable defect rather than two texts that happen to differ.
    expect(found).toEqual({
      kind: "rule-mentions-signal",
      from: "skills/lazy.md",
      to: "sig-0002",
      sourceDoc: ".wst/skills/lazy.md",
    });
  });

  it("reads check → decision off the check's origin", () => {
    const found = edgesOf(world()).filter((e) => e.kind === "check-rests-on-decision");

    expect(found).toHaveLength(1);
    expect(found[0]?.to).toBe("adr-0007");
  });
});

describe("contradictionsIn — where a document rests on something that moved", () => {
  /**
   * The rule that is NOT here, and why. A first version reported a skill citing a
   * signal that does not cite it back. Run against this repo it found eight
   * problems and one was real: `lazy.md` cites five signals as EXAMPLES of the
   * pattern it describes, and `tdd-discipline.md` cites two ids belonging to
   * another repo's log, saying so in the same sentence. A check that is red for
   * the wrong reason gets routed around, and then it stops catching the real one.
   */
  it("stays quiet about a skill citing a signal that names a different rule", () => {
    expect(contradictionsIn(world()).filter((c) => c.path.includes("lazy"))).toEqual([]);
  });

  it("catches a check resting on a decision that no longer holds", () => {
    const found = contradictionsIn(world()).filter((c) => c.kind === "stale-foundation");

    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain("adr-0007");
    expect(found[0]?.detail).toContain("adr-0019");
  });

  it("says nothing about a repo whose edges agree", () => {
    const agreeing = {
      signals: '{"id":"sig-0002","type":"x","detail":"d","rule_affected":["skills/lazy.md"]}',
      skills: { "skills/lazy.md": "Earned by `sig-0002`." },
      checks: { "checks/x.md": "origin: [adr-0019]\n" },
      decisions: DECISIONS,
    };

    expect(contradictionsIn(agreeing)).toEqual([]);
  });
});
