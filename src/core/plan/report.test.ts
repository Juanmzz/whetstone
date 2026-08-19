/**
 * The plan report. Same standard `core/gate/report.ts` is held to: never let a
 * reader conclude "verified" from something that was not. Here the stakes are one
 * step earlier — the reader is deciding whether the plan is ready to dispatch, so a
 * silence they read as coverage is a hole they will not go looking for.
 */

import { describe, expect, it } from "vitest";
import { buildRegistry, type LoadedCheck } from "../checks/registry.js";
import type { TriageRule } from "../contracts.js";
import { previewPlan } from "./preview.js";
import { renderPlanPreview } from "./report.js";

function check(over: Partial<LoadedCheck> = {}): LoadedCheck {
  return {
    id: "typecheck",
    description: "TypeScript compiles.",
    kind: "deterministic",
    severity: "block",
    tiers: ["strict", "light"],
    include: ["src/**/*.ts"],
    exclude: [],
    enabled: true,
    version: 1,
    origin: [],
    command: "npm run typecheck",
    body: "",
    ...over,
  };
}

const LENS = check({
  id: "correctness",
  kind: "llm",
  severity: "warn",
  tiers: ["strict"],
  command: undefined,
  review_lens: "look for bugs",
});

const RULES: readonly TriageRule[] = [
  { glob: "src/core/**", tier: "strict", reason: "the deterministic engine" },
  { glob: "docs/**", tier: "light", reason: "documentation" },
];

const render = (paths: readonly string[], registry = buildRegistry([check(), LENS]), intent: string | null = null): string =>
  renderPlanPreview(previewPlan(paths, RULES, "triage.yaml", registry), { intent, source: "PLAN.md" });

describe("renderPlanPreview", () => {
  it("leads with the tier and the reason it earned it", () => {
    const out = render(["src/core/a.ts"]);
    expect(out).toContain("tier     strict");
    expect(out).toContain("the deterministic engine");
  });

  it("truncates the tier reason for the terminal but never for --json", () => {
    // A triage rule's `reason` is a paragraph — it is the audit trail, not a label.
    // `wst triage` already draws this line: the terminal is a viewport, and the full
    // text survives in `--json`, which renders none of this.
    const long = "x".repeat(400);
    const out = renderPlanPreview(
      previewPlan(["src/core/a.ts"], [{ glob: "src/core/**", tier: "strict", reason: long }], "triage.yaml", buildRegistry([check()])),
      { intent: null, source: "PLAN.md" },
    );
    expect(out).toContain("…");
    expect(out).not.toContain(long);
  });

  it("says out loud that the tier is a prediction, not the enforced one", () => {
    // ADR-0013 accepts this tradeoff explicitly and requires the divergence to be
    // reportable: "a predicted tier that silently disagrees with the enforced one is
    // worse than no prediction". The report cannot see the divergence, so it names
    // the thing that can.
    expect(render(["src/core/a.ts"])).toMatch(/prediction/i);
  });

  it("separates the checks that can stop the change from the ones that cannot", () => {
    const out = render(["src/core/a.ts"]);
    expect(out).toContain("blocking");
    expect(out).toContain("typecheck");
    expect(out).toContain("advisory");
    expect(out).toContain("correctness");
  });

  it("says so when nothing that runs is allowed to block", () => {
    // The failure this exists to stop: a plan listing one green-looking check that
    // is capped at `warn`, read as "the gate has this covered".
    const out = render(["src/core/a.ts"], buildRegistry([LENS]));
    expect(out).toMatch(/nothing .* can block/i);
  });

  it("names a strict path no check covers, and asks for it by hand", () => {
    const out = render(["src/core/a.ts", "src/core/NOTES.md"]);
    expect(out).toContain("src/core/NOTES.md");
    expect(out).toMatch(/by hand/i);
  });

  it("states an uncovered light path as a gap rather than omitting it", () => {
    const out = render(["src/core/a.ts", "docs/x.md"]);
    expect(out).toContain("docs/x.md");
    expect(out).toContain("not covered");
  });

  it("reports a check that will not look at anything declared", () => {
    const out = render(["docs/x.md"]);
    expect(out).toMatch(/matched no declared path/);
    expect(out).toContain("typecheck");
  });

  it("refuses to imply coverage when no check applies at all", () => {
    const out = render(["docs/x.md"], buildRegistry([]));
    expect(out).toMatch(/no check applies/i);
  });

  it("prints the intent when the plan states one, and says so when it does not", () => {
    expect(render(["src/core/a.ts"], undefined, "Build the plan gate")).toContain("Build the plan gate");
    expect(render(["src/core/a.ts"])).toMatch(/intent .*not stated/i);
  });

  it("names where the plan and the rules came from, so the answer is re-checkable", () => {
    const out = render(["src/core/a.ts"]);
    expect(out).toContain("PLAN.md");
    expect(out).toContain("triage.yaml");
  });
});
