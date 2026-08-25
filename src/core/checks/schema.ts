/**
 * The check schema — Layer 0, and the contract Steps 2 and 3 both consume.
 *
 * The important design decision here: constitution non-negotiable 7 ("a judgment
 * check earns its `block`") is enforced AT PARSE TIME, not at run time. The registry
 * physically refuses to load an `llm` check that declares `severity: block`
 * without a passing calibration receipt. A rule enforced by the schema cannot be
 * forgotten, worked around in a hurry, or lost when someone edits the gate.
 */

import { z } from "zod";
import { AGENTS } from "../config/schema.js";

export const TIERS = ["strict", "light", "off"] as const;
/** Triage tier. Exported as a type so triage/ and gate/ share one definition. */
export type Tier = (typeof TIERS)[number];
export const SEVERITIES = ["block", "warn", "annotate"] as const;
/**
 * `method` is adr-0018's third kind: prose an agent FOLLOWS, for verification that
 * is neither an exit code nor a diff review — drive the browser, take the
 * screenshots, compare them against the design. It is selected by the same globs
 * and tiers as everything else here, which is the whole reason it lives in this
 * registry instead of a second one.
 */
export const KINDS = ["deterministic", "llm", "method"] as const;

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
  /**
   * Whether a receipt may stand in for running this check.
   *
   * A receipt proves "this check passed on these file contents", so it is only
   * evidence for a check whose answer is a function of those contents. One that
   * reads `WST_GATE_RANGE` answers a different question per range, and the range
   * is not in the hash.
   */
  skippable: z.boolean().default(true),
  /** Too slow to answer while somebody waits. Absent means cheap. */
  slow: z.boolean().default(false),
  /** Bumped when behaviour changes — part of the receipt's input hash. */
  version: z.number().int().min(1).default(1),
  /** Signals / ADRs that earned this check. Empty means unearned. */
  origin: z.array(z.string()).default([]),
  owner: z.string().nullish(),

  /** Required when kind === "deterministic". */
  command: z.string().min(1).optional(),
  /** Required when kind === "llm". Appended to the system prompt. */
  review_lens: z.string().min(1).optional(),
  /**
   * Which judge runs this lens. Absent means the one `wst.yaml` selects.
   *
   * Two judges report side by side and never vote (adr-0026), which is only
   * expressible per check: one global agent gives every lens the same judge, and
   * the second verdict never exists to disagree with the first.
   */
  agent: z.enum(AGENTS).optional(),
  calibration: CalibrationSchema.optional(),
});

export const CheckSchema = BaseCheck.superRefine((check, ctx) => {
  if (check.kind === "method") {
    // The gate cannot enforce a method — its outcome is a human's judgment or an
    // agent's report — so any severity above `annotate` is a promise nothing
    // keeps. Enforced here for the same reason non-negotiable 2 is: a rule the
    // parser applies cannot be forgotten by whoever writes the next check file.
    if (check.severity !== "annotate") {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message: `a method check may only be \`annotate\`: the gate cannot enforce it, and a method claiming \`${check.severity}\` promises a verdict nothing produces`,
      });
    }
    for (const field of ["command", "review_lens"] as const) {
      if (check[field] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `a method check must not declare \`${field}\`: a method is prose an agent follows, and declaring one makes it a different kind wearing this name`,
        });
      }
    }
    return;
  }

  if (check.kind === "deterministic") {
    if (check.command === undefined) {
      ctx.addIssue({ code: "custom", path: ["command"], message: "a deterministic check requires `command`" });
    }
    if (check.review_lens !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["review_lens"],
        message: "a deterministic check must not declare `review_lens`: pick one kind",
      });
    }
    return;
  }

  // kind === "llm"
  if (check.review_lens === undefined) {
    ctx.addIssue({ code: "custom", path: ["review_lens"], message: "an llm check requires `review_lens`" });
  }
  if (check.command !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["command"],
      message: "an llm check must not declare `command`: pick one kind",
    });
  }

  // Non-negotiable 7 is NOT decided here any more. A zod schema sees one file's text
  // and cannot recompute a fixture-set hash, so "has this lens earned block?" moved to
  // `parseCheckFile`, which is handed the receipt. Leaving a weaker version of the rule
  // here as well would be two authorities that can disagree.
});

export type Check = z.infer<typeof CheckSchema>;
