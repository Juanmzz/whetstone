import { describe, expect, it } from "vitest";
import { retroEnvelope } from "./machine.js";
import type { Recommendation } from "./propose.js";

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  clusterKey: "skills/lazy.md",
  kind: "amend",
  target: ".wst/skills/lazy.md",
  summary: "reuse before adding",
  rationale: "three signals are one rule implemented twice",
  citedSignals: ["sig-0002", "sig-0012"],
  ...over,
});

describe("retroEnvelope — proposals an agent can present without paraphrasing", () => {
  it("keeps each proposal's cited signals, which are the receipt", () => {
    const env = retroEnvelope({ signals: 54, fresh: 11, clusters: 7, accepted: [rec()], rejected: [], costUsd: 0.72 });

    expect(env.proposals[0]?.citedSignals).toEqual(["sig-0002", "sig-0012"]);
  });

  it("returns rejected proposals WITH the reasons, not just a count", () => {
    // The anti-poisoning gate is the interesting output. A caller that only sees
    // accepted ones cannot tell a quiet retro from one that caught a fabrication.
    const env = retroEnvelope({
      signals: 54,
      fresh: 11,
      clusters: 7,
      accepted: [],
      rejected: [{ rec: rec(), reasons: ["cites sig-9999, which is not in the log"] }],
      costUsd: 0.1,
    });

    expect(env.rejected).toEqual([
      { target: ".wst/skills/lazy.md", summary: "reuse before adding", reasons: ["cites sig-9999, which is not in the log"] },
    ]);
  });

  it("says nothing was applied, because nothing ever is", () => {
    // adr-0003: the retro proposes and a human signs. An agent that assumed
    // otherwise would report a change that did not happen.
    expect(retroEnvelope({ signals: 0, fresh: 0, clusters: 0, accepted: [], rejected: [], costUsd: 0 }).applied).toBe(false);
  });

  it("reports what the run cost, since it spends real money", () => {
    expect(retroEnvelope({ signals: 1, fresh: 1, clusters: 1, accepted: [], rejected: [], costUsd: 0.7283 }).costUsd).toBe(0.7283);
  });
});
