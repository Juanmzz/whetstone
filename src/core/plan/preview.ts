/**
 * What will judge this plan. PURE, and deterministic end to end — no model. Why an
 * LLM was rejected here: adr-0013.
 *
 * Nothing here classifies anything. `classify`, `route` and `selectChecks` are the
 * gate's own functions, called unchanged. A second implementation of "which checks
 * match which paths" would be a front door answering a question about a gate that
 * does not exist — the same divergence `commands/gate.ts` records having already
 * cost this project three bugs.
 *
 * The one thing this module adds is the view the gate never needs: coverage read
 * PER PATH rather than per check, so an uncovered path is stated as a gap rather
 * than left as silence.
 */

import type { Check, Tier } from "../checks/schema.js";
import type { Registry } from "../checks/registry.js";
import type { Routing, TriageResult, TriageRule } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";
import { selectChecks } from "../gate/select.js";
import { classify, route } from "../triage/index.js";

/** A check that will run, and which of the declared paths it would look at. */
export interface PlannedCheck {
  readonly id: string;
  readonly kind: Check["kind"];
  readonly severity: Check["severity"];
  readonly paths: readonly string[];
}

/** One declared path, and everything that would look at it. */
export interface PathCoverage {
  readonly path: string;
  /**
   * The tier THIS path earns on its own, not the change's maximum.
   *
   * The distinction is the whole of question 3. A plan touching one engine file and
   * six documents is strict as a whole, but "which paths must a human verify by
   * hand" is about the engine file — reporting all seven would drown the one that
   * matters.
   */
  readonly tier: Tier;
  readonly checks: readonly string[];
  /** The subset of `checks` that may actually stop the change. */
  readonly blocking: readonly string[];
}

export interface PlanPreview {
  /** Question 1: the tier, and the per-path rule matches that produced it. */
  readonly triage: TriageResult;
  readonly routing: Routing;
  /** Question 2, first half: checks that may stop the change. */
  readonly blocking: readonly PlannedCheck[];
  /** Question 2, second half: checks that will report and let it through. */
  readonly advisory: readonly PlannedCheck[];
  /**
   * Routed and in tier, but matching none of the declared paths. Reported because
   * "this check will not look at anything you declared" is a different fact from
   * "this check will pass", and only one of them is reassuring.
   */
  readonly unmatched: readonly string[];
  /**
   * Routing named a check the registry does not have. The REGISTRY being broken,
   * not the plan — rule 3, arriving here through `selectChecks`.
   */
  readonly missingFromRegistry: readonly string[];
  /** Every declared path, in declaration order. */
  readonly coverage: readonly PathCoverage[];
  /** Question 4: declared paths no check would look at. */
  readonly uncovered: readonly PathCoverage[];
  /** Question 3: uncovered AND strict — the hand-verification list. */
  readonly manual: readonly PathCoverage[];
  /**
   * Covered, but by nothing that may block. Part of question 4: a path whose entire
   * coverage is an advisory lens is reported on and then waved through, and filing
   * it under "covered" would tell the reader they are protected when they are not.
   */
  readonly advisoryOnly: readonly PathCoverage[];
}

/**
 * A declared path as `classify` wants it.
 *
 * `modified` is the only honest status: a plan says WHICH paths it expects to touch
 * and not how. `renamed` would ask `classify` to escalate on a pre-rename path the
 * plan never supplied, and `added`/`deleted` claim knowledge the declaration does
 * not carry. Since no triage rule reads `status` except through that rename
 * escalation, the choice costs nothing and invents nothing.
 */
export function declaredFiles(paths: readonly string[]): ChangedFile[] {
  return paths.map((path) => ({ path, status: "modified" }));
}

export function previewPlan(
  paths: readonly string[],
  rules: readonly TriageRule[],
  rulesSource: string,
  registry: Registry,
): PlanPreview {
  const files = declaredFiles(paths);

  // The gate's own two calls, in the gate's own order. `commands/gate.ts` routes
  // from `route(tier, registry.active)`; anything else here would predict a tier
  // the gate would not use.
  const triage = classify(files, rules, rulesSource);
  const routing = route(triage.tier, registry.active);

  // `selection.excluded` is not surfaced: `route` has already filtered on the same
  // two predicates (enabled, in tier), so it can only ever be empty here.
  const selection = selectChecks(routing, registry, files);

  const planned: PlannedCheck[] = selection.selected.map(({ check, files: matched }) => ({
    id: check.id,
    kind: check.kind,
    severity: check.severity,
    paths: matched.map((f) => f.path),
  }));

  const coverage: PathCoverage[] = triage.matches.map((match) => {
    const covering = planned.filter((c) => c.paths.includes(match.file.path));
    return {
      path: match.file.path,
      tier: match.tier,
      checks: covering.map((c) => c.id),
      blocking: covering.filter((c) => c.severity === "block").map((c) => c.id),
    };
  });

  const uncovered = coverage.filter((c) => c.checks.length === 0);

  return {
    triage,
    routing,
    blocking: planned.filter((c) => c.severity === "block"),
    advisory: planned.filter((c) => c.severity !== "block"),
    unmatched: selection.unmatched,
    missingFromRegistry: selection.missingFromRegistry,
    coverage,
    uncovered,
    manual: uncovered.filter((c) => c.tier === "strict"),
    advisoryOnly: coverage.filter((c) => c.checks.length > 0 && c.blocking.length === 0),
  };
}
