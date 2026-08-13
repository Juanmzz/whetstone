/**
 * Rendering the plan preview. PURE, and held to `core/gate/report.ts`'s standard:
 * never let a reader conclude "verified" from something that was not.
 *
 * One layer earlier than the gate's report, and the failure mode is different. The
 * gate reports on work that is done; this reports on work that has not started, to a
 * human who is about to decide whether the plan is ready to dispatch. So the
 * dangerous output is not a wrong word, it is an OMISSION: a path nothing will
 * verify, left off the list, reads as a path that is fine. ADR-0013 says it in the
 * fourth question — "what is *not* covered, stated as a gap rather than as silence".
 *
 * There is no exit code to render into. `wst plan` does not block: "the name says
 * gate and the gate is the human, in the same sense `wst signal` is for the human to
 * type. The command emits; the person decides."
 */

import type { PathCoverage, PlanPreview, PlannedCheck } from "./preview.js";

export interface PlanSource {
  /** What the plan says it is for. `null` when it did not say. */
  readonly intent: string | null;
  /** The plan file, or `-` for stdin. Half of what makes the answer re-checkable. */
  readonly source: string;
}

const COLUMN = 14;

/**
 * A triage rule's `reason` is a paragraph, not a label — it is the audit trail for
 * why a path earns its tier. `wst triage` already drew this line and the same one
 * applies: the terminal is a viewport, and the full text survives untouched into
 * `--json`, which renders none of this.
 */
const REASON_WIDTH = 160;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function checkLines(checks: readonly PlannedCheck[]): string[] {
  return checks.map((c) => `    ${c.id.padEnd(COLUMN)}${c.paths.join(", ")}`);
}

function coverageLines(paths: readonly PathCoverage[], suffix = ""): string[] {
  return paths.map((p) => `    ${p.tier.padEnd(8)}${p.path}${suffix}`);
}

export function renderPlanPreview(preview: PlanPreview, plan: PlanSource): string {
  const { triage, routing } = preview;
  const declared = triage.matches.length;

  const lines: string[] = [
    "whetstone — plan",
    "",
    `  intent   ${plan.intent ?? "(not stated in the plan)"}`,
    `  tier     ${routing.tier}`,
    `           ${truncate(triage.reason, REASON_WIDTH)}`,
    `  plan     ${plan.source} — ${declared} declared path(s)`,
    `  rules    ${triage.rulesSource}`,
    "",
  ];

  if (preview.blocking.length > 0) {
    lines.push("  blocking — these run on this plan and may stop it", ...checkLines(preview.blocking));
  } else if (preview.advisory.length > 0) {
    // Not silence. A plan whose only checks are capped at `warn` is one a reader
    // will otherwise file as covered, and the gate will wave it through no matter
    // what those checks say.
    lines.push("  blocking — nothing that runs on this plan can block it");
  }

  if (preview.advisory.length > 0) {
    lines.push("", "  advisory — reported, never blocking", ...checkLines(preview.advisory));
  }

  if (preview.blocking.length === 0 && preview.advisory.length === 0) {
    // The same refusal `exitCodeFor` makes: a run that verified nothing is not a
    // pass, so a plan nothing applies to is not a safe plan.
    lines.push("  no check applies to any declared path — this plan would be verified by nothing");
  }

  if (preview.unmatched.length > 0) {
    // Named, not counted, for the reason `core/gate/report.ts` gives: node's
    // `matchesGlob` returns false for a malformed pattern rather than throwing, so a
    // typo in `include` is indistinguishable from a check that legitimately does not
    // apply.
    lines.push("", `  matched no declared path: ${preview.unmatched.join(", ")}`);
  }

  if (preview.unknown.length > 0) {
    // The REGISTRY is broken, not the plan — rule 3, one layer early.
    lines.push(
      "",
      `  routed but missing from the registry: ${preview.unknown.join(", ")}`,
      "  that is the check registry being wrong, not this plan",
    );
  }

  if (preview.manual.length > 0) {
    lines.push(
      "",
      "  VERIFY BY HAND — strict paths no check covers",
      ...coverageLines(preview.manual),
    );
  }

  const otherGaps = preview.uncovered.filter((p) => p.tier !== "strict");
  if (otherGaps.length > 0) {
    lines.push("", "  not covered — no check will look at these", ...coverageLines(otherGaps));
  }

  if (preview.advisoryOnly.length > 0) {
    lines.push(
      "",
      "  not covered by anything that blocks — advisory cover only",
      ...coverageLines(preview.advisoryOnly),
    );
  }

  lines.push(
    "",
    "  This tier is a PREDICTION from the paths the plan declared. `wst gate` classifies",
    "  the real diff, and a change that grows past its plan earns its real tier there.",
  );

  return lines.join("\n");
}
