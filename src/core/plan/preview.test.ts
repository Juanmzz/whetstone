/**
 * The four questions ADR-0013 says `wst plan` answers, and nothing else.
 *
 * Everything here is checked against the SAME functions the gate routes with —
 * `classify`, `route`, `selectChecks`. That is the point of the command: if the
 * preview computed coverage its own way, the front door would answer a question
 * about a gate that does not exist.
 */

import { describe, expect, it } from "vitest";
import { buildRegistry, type LoadedCheck } from "../checks/registry.js";
import type { TriageRule } from "../contracts.js";
import { declaredFiles, previewPlan } from "./preview.js";

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

const RULES: readonly TriageRule[] = [
  { glob: "src/core/**", tier: "strict", reason: "the deterministic engine" },
  { glob: "src/commands/**", tier: "light", reason: "composition roots" },
  { glob: "docs/**", tier: "light", reason: "documentation" },
];

const REGISTRY = buildRegistry([
  check(),
  check({ id: "correctness", kind: "llm", severity: "warn", tiers: ["strict"], command: undefined, review_lens: "look for bugs" }),
]);

describe("declaredFiles", () => {
  it("presents a declared path as a modified file", () => {
    // A plan says WHICH paths, never HOW they change, and `modified` is the only
    // status that adds nothing: `renamed` would ask `classify` to escalate on a
    // pre-rename path the plan never gave it.
    expect(declaredFiles(["src/core/x.ts"])).toEqual([{ path: "src/core/x.ts", status: "modified" }]);
  });
});

describe("previewPlan", () => {
  it("reports the tier the declared paths earn, from classify", () => {
    const preview = previewPlan(["src/commands/plan.ts", "src/core/plan/preview.ts"], RULES, "rules.yaml", REGISTRY);
    // The MAXIMUM, exactly as the gate takes it: one engine file makes the whole
    // plan strict.
    expect(preview.triage.tier).toBe("strict");
    expect(preview.routing.tier).toBe("strict");
  });

  it("splits the checks that will run into blocking and advisory", () => {
    const preview = previewPlan(["src/core/plan/preview.ts"], RULES, "rules.yaml", REGISTRY);
    expect(preview.blocking.map((c) => c.id)).toEqual(["typecheck"]);
    expect(preview.advisory.map((c) => c.id)).toEqual(["correctness"]);
  });

  it("names the declared paths each check would look at", () => {
    const preview = previewPlan(["src/core/a.ts", "docs/b.md"], RULES, "rules.yaml", REGISTRY);
    expect(preview.blocking[0]?.paths).toEqual(["src/core/a.ts"]);
  });

  it("reports a strict path no check covers — the hand-verification list", () => {
    // ADR-0013's third question. `.md` under `src/core/` is strict by rule and
    // matched by no check in this registry, so a human is the only thing that will
    // look at it.
    const preview = previewPlan(["src/core/a.ts", "src/core/NOTES.md"], RULES, "rules.yaml", REGISTRY);
    expect(preview.manual.map((p) => p.path)).toEqual(["src/core/NOTES.md"]);
  });

  it("reports every uncovered path, not only the strict ones", () => {
    // The fourth question: "what is not covered, stated as a gap rather than as
    // silence". A light path nothing verifies is still a path nothing verifies.
    const preview = previewPlan(["src/core/a.ts", "docs/b.md"], RULES, "rules.yaml", REGISTRY);
    expect(preview.uncovered.map((p) => p.path)).toEqual(["docs/b.md"]);
    expect(preview.manual).toEqual([]);
  });

  it("separates a path whose only cover may not block", () => {
    // Covered is not verified. A path whose entire coverage is an advisory lens
    // passes the gate no matter what that lens says, and a report that filed it
    // under "covered" would be telling the reader they are protected.
    const lensOnly = buildRegistry([
      check({ id: "correctness", kind: "llm", severity: "warn", tiers: ["strict"], command: undefined, review_lens: "look for bugs" }),
    ]);
    const preview = previewPlan(["src/core/a.ts"], RULES, "rules.yaml", lensOnly);
    expect(preview.advisoryOnly.map((p) => p.path)).toEqual(["src/core/a.ts"]);
    expect(preview.uncovered).toEqual([]);
  });

  it("reports a check that is in tier but matches nothing the plan declared", () => {
    const preview = previewPlan(["docs/b.md"], RULES, "rules.yaml", REGISTRY);
    // `light` routes typecheck, which no declared path matches. Saying so is the
    // difference between "this check passed" and "this check never looked".
    expect(preview.routing.tier).toBe("light");
    expect(preview.unmatched).toContain("typecheck");
    expect(preview.blocking).toEqual([]);
  });

  it("carries the rules source through, so the prediction is re-checkable", () => {
    const preview = previewPlan(["src/core/a.ts"], RULES, "rules.yaml", REGISTRY);
    expect(preview.triage.rulesSource).toBe("rules.yaml");
  });

  it("records coverage per declared path, with the path's own tier", () => {
    const preview = previewPlan(["src/core/a.ts", "src/commands/b.ts"], RULES, "rules.yaml", REGISTRY);
    // Two things are pinned here and the second is easy to get wrong.
    //
    // Check order is the registry's, which sorts by id — the same order the gate
    // would run them in, so the two reports read the same way.
    //
    // And `correctness` covers the LIGHT path too. Routing is per CHANGE, not per
    // file: the plan is strict, so the strict-only lens is selected, and from there
    // it matches on its own `include` glob. A preview that filtered coverage by the
    // path's own tier would under-report what the gate is about to do.
    expect(preview.coverage).toEqual([
      { path: "src/core/a.ts", tier: "strict", checks: ["correctness", "typecheck"], blocking: ["typecheck"] },
      { path: "src/commands/b.ts", tier: "light", checks: ["correctness", "typecheck"], blocking: ["typecheck"] },
    ]);
  });
});
