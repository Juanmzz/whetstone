/**
 * The check schema — Layer 0, and the contract Steps 2 and 3 both consume.
 *
 * The important design decision here: constitution non-negotiable 7 ("a judgment
 * check earns its `block`") is enforced AT PARSE TIME, not at run time. The registry
 * physically refuses to load an `agent-lens` check that declares `severity: block`
 * without a passing calibration receipt. A rule enforced by the schema cannot be
 * forgotten, worked around in a hurry, or lost when someone edits the gate.
 */

import { z } from "zod";

export const TIERS = ["strict", "light", "off"] as const;
/** Triage tier. Exported as a type so triage/ and gate/ share one definition. */
export type Tier = (typeof TIERS)[number];
export const SEVERITIES = ["block", "warn", "annotate"] as const;
export const KINDS = ["deterministic", "agent-lens"] as const;

/**
 * Where the measurement lives, and a note for whoever reads the file.
 *
 * What is NOT here any more: `status`. It used to be the whole mechanism — a lens
 * declaring `status: passed` with `runs: 1` was granted blocking authority, and both
 * fields were typed by hand. Editing three lines promoted an unmeasured lens to
 * `block`; that was demonstrated, not feared. Authority now comes from
 * `<id>.calibration.json`, whose hashes the loader recomputes (`core/calibration/`).
 *
 * These fields are prose for humans. They grant nothing.
 */
export const CalibrationSchema = z.strictObject({
  /** Fixture directory the receipt was measured against, for re-running. */
  fixtures: z.string().optional(),
  detail: z.string().optional(),
});

export type Calibration = z.infer<typeof CalibrationSchema>;

const BaseCheck = z.strictObject({
  /** Must equal the filename stem — receipts and `origin` refs point at it. */
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case (a-z, 0-9, hyphens)"),
  description: z.string().min(1),
  kind: z.enum(KINDS),
  severity: z.enum(SEVERITIES),
  /** Which triage tiers this check applies to. */
  tiers: z.array(z.enum(TIERS)).min(1),
  /** Globs that trigger the check. Matched against changed file paths. */
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  /** Bumped when behaviour changes — part of the receipt's input hash. */
  version: z.number().int().min(1).default(1),
  /** Signals / ADRs that earned this check. Empty means unearned. */
  origin: z.array(z.string()).default([]),
  owner: z.string().nullish(),

  /** Required when kind === "deterministic". */
  command: z.string().min(1).optional(),
  /** Required when kind === "agent-lens". Appended to the system prompt. */
  review_lens: z.string().min(1).optional(),
  calibration: CalibrationSchema.optional(),
});

export const CheckSchema = BaseCheck.superRefine((check, ctx) => {
  if (check.kind === "deterministic") {
    if (check.command === undefined) {
      ctx.addIssue({ code: "custom", path: ["command"], message: "a deterministic check requires `command`" });
    }
    if (check.review_lens !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["review_lens"],
        message: "a deterministic check must not declare `review_lens` — pick one kind",
      });
    }
    return;
  }

  // kind === "agent-lens"
  if (check.review_lens === undefined) {
    ctx.addIssue({ code: "custom", path: ["review_lens"], message: "an agent-lens check requires `review_lens`" });
  }
  if (check.command !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["command"],
      message: "an agent-lens check must not declare `command` — pick one kind",
    });
  }

  // Non-negotiable 7 is NOT decided here any more. A zod schema sees one file's text
  // and cannot recompute a fixture-set hash, so "has this lens earned block?" moved to
  // `parseCheckFile`, which is handed the receipt. Leaving a weaker version of the rule
  // here as well would be two authorities that can disagree.
});

export type Check = z.infer<typeof CheckSchema>;
