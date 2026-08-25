/**
 * The triage rules loader. PURE — text in, validated rules out. Reading
 * `.wst/triage.yaml` off disk belongs to the composition root
 * (`src/commands/triage.ts`), so the format stays testable without a filesystem.
 */

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { TIERS } from "../checks/schema.js";
import type { TriageRule } from "../contracts.js";
import { DEFINITION_DIR } from "../paths.js";

/**
 * Format tag, same reasoning as `RECEIPT_INPUT_FORMAT`: reading a v2 document
 * with a v1 parser produces a plausible-looking, wrong ruleset — and a wrong
 * ruleset is invisible, because every change still gets *a* tier.
 */
export const TRIAGE_RULES_FORMAT = 1;

const nonBlank = (field: string, why: string) =>
  z
    .string(`${field} must be a string`)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: `${field} must not be blank: ${why}` });

const RuleSchema = z.strictObject({
  glob: nonBlank("glob", "a rule that matches nothing is dead weight in a first-match-wins list"),
  tier: z.enum(TIERS),
  reason: nonBlank(
    "reason",
    "a rule that cannot say why it exists cannot be reviewed, and therefore cannot be retired",
  ),
});

const DocumentSchema = z.strictObject({
  version: z.literal(TRIAGE_RULES_FORMAT, `version must be ${TRIAGE_RULES_FORMAT}`),
  rules: z
    .array(RuleSchema)
    .min(1, "a triage document with no rules classifies nothing: delete the file instead"),
});

/**
 * Parses a triage document. THROWS on anything it does not understand, for the
 * same reason `core/diff/parse.ts` does: a gate that silently drops a malformed
 * rule leaves the files that rule covered ungated, which is the worst possible
 * failure for a tool whose job is to not let things through.
 */
export function parseTriageRules(
  text: string,
  source = `${DEFINITION_DIR}/triage.yaml`,
): TriageRule[] {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${source}: not valid YAML: ${detail}`);
  }

  const parsed = DocumentSchema.safeParse(raw);
  if (!parsed.success) {
    // Readable over machine-shaped, matching `checks/registry.ts`: this is the
    // error a human hits when their config is wrong, and a raw zod dump makes
    // them work to find the field.
    const issues = parsed.error.issues
      .map((i) => `    ${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${source}: invalid triage rules\n${issues}`);
  }

  // Two rules with the identical glob means the second can never fire. A dead
  // rule is worse than a missing one: someone believes the project is covered.
  const seen = new Set<string>();
  for (const rule of parsed.data.rules) {
    if (seen.has(rule.glob)) {
      throw new Error(
        `${source}: duplicate glob ${JSON.stringify(rule.glob)}: under first-match-wins the ` +
          `later rule can never fire, so it is dead. Merge them, or narrow one.`,
      );
    }
    seen.add(rule.glob);
  }

  return parsed.data.rules;
}

/**
 * The text of `.wst/triage.yaml`. Compiled BY HAND from the table in
 * `.wst/triage-rules.md` — that file is the source (ADR-0005), this is its
 * machine-readable form. Change the table first, never the reverse.
 */
export const DEFAULT_RULES_YAML = `# Triage rules: the machine-readable form of the table in ${DEFINITION_DIR}/triage-rules.md.
# That table is the SOURCE (ADR-0005); this file is compiled from it by hand for
# now. Change the table first, never the reverse.
#
# ORDER IS PRECEDENCE. Classification is FIRST-MATCH-WINS per file, so a broad
# rule placed above a narrow one silently demotes everything the narrow one was
# written to catch: and the failure is invisible, because the change still gets
# *a* tier, just the wrong one. Most specific first.
#
# The tier of a whole CHANGE is the MAXIMUM across the files it touches: one
# strict file makes the whole change strict. Size only escalates, never
# de-escalates.
#
# A file that matches NO rule falls back to \`light\`. That fallback lives in code
# (src/core/triage/classify.ts), not here, because it cannot be written as a
# trailing \`**\` rule: node:path's matchesGlob will not let \`**\` cross a
# dot-leading segment, so such a rule would silently miss every dotfile.

version: 1

rules:
  # ── strict: full TDD: RED, GREEN, TRIANGULATE, REFACTOR ───────────────────

  - glob: "src/core/**"
    tier: strict
    reason: >-
      The deterministic engine: triage, check selection, receipts, the gate
      verdict, the LLM verdict contract. A bug here silently mis-gates every
      change in every project that runs Whetstone.

  - glob: "${DEFINITION_DIR}/skills/**"
    tier: strict
    reason: >-
      Payload that propagates verbatim into every bootstrapped project. The
      blast radius is every future project, and a bad rule travels a long way
      before anyone notices it.

  - glob: ".claude/hooks/**"
    tier: strict
    reason: >-
      Emitter output, compiled from ${DEFINITION_DIR}/ (ADR-0005). A wrong hook denies or
      allows the wrong writes in every project it is installed into, and it
      fails open, which looks like working.

  # ── off: no ceremony ──────────────────────────────────────────────────────
  # Only the retro log is expressible as a path. The rest of the \`off\` row in
  # ${DEFINITION_DIR}/triage-rules.md (typos, formatting, changelog lines) is about CONTENT,
  # which a path-glob engine cannot see; those changes land at \`light\` and are
  # waved through by a human instead. Listed above the broader ${DEFINITION_DIR}/memory rule
  # so it cannot be shadowed.

  - glob: "${DEFINITION_DIR}/memory/retro-log.md"
    tier: off
    reason: >-
      An append-only record of retros that already happened. Nothing downstream
      reads it as a rule, so an error in it cannot mis-gate anything.

  # ── light: reasoned before merge, no test ceremony ────────────────────────

  - glob: "src/shell/**"
    tier: light
    reason: >-
      The imperative shell: thin adapters with no branching logic, covered by
      integration rather than unit tests. Anything worth unit-testing here has
      been put in the wrong layer.

  - glob: "src/commands/**"
    tier: light
    reason: >-
      Composition roots: build the adapters, call the core, print. Decisions
      belong in core/, which is strict; a decision found here is a design bug
      before it is a testing one.

  - glob: "src/cli.ts"
    tier: light
    reason: >-
      Commander wiring only, zero logic, so that the CLI surface stays
      swappable without touching the engine.

  - glob: "${DEFINITION_DIR}/memory/decisions.md"
    tier: light
    reason: >-
      The decision record. Accepted text is never rewritten (ADR-0019): it is
      superseded, or compacted by selection: so the risk lives in the decision
      itself, not in the prose.

  - glob: "{README,VISION,AGENTS,CLAUDE}.md"
    tier: light
    reason: >-
      Governance and design prose that does NOT propagate into bootstrapped
      projects. Wrong here costs a reader an hour; wrong in the payload costs
      every project.

  - glob: "docs/**"
    tier: light
    reason: >-
      Design and reference documentation.
`;

/** The parse of `DEFAULT_RULES_YAML`. One source: these cannot drift apart. */
export const DEFAULT_RULES: readonly TriageRule[] = Object.freeze(
  parseTriageRules(DEFAULT_RULES_YAML, "<built-in default rules>"),
);
