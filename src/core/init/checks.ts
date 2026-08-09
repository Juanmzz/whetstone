/**
 * Seeding `.sdd/checks/`.
 *
 * Two rules govern this module, and both of them are about what NOT to write.
 *
 * **1. Never seed a check whose command might not exist.** A check that cannot
 * run does not report `fail` — it reports `errored`, on every change, forever.
 * That reads as "the gate is broken", and a gate believed broken is switched off.
 * So every command here comes from `detectStack`, which only ever reports a
 * command it read out of the project's own scripts or one the detected toolchain
 * guarantees. A repo with no runner gets ZERO checks, which is the correct answer.
 *
 * **2. An `agent-lens` check may never be seeded at `severity: block`.** A fresh
 * repo has no calibration receipt by definition, and `CheckSchema` refuses the
 * combination at parse time — so an init that emitted one would hand over a repo
 * whose registry cannot load. The cap is applied here as well as in the schema,
 * because relying on a downstream throw to enforce it means shipping the bug and
 * discovering it in someone else's terminal.
 */

import type { Check } from "../checks/schema.js";
import { yamlBlock, yamlList, yamlString, type GeneratedFile } from "./artifact.js";
import type { StackFacts } from "./detect.js";

export interface SeedChecksOptions {
  /** ISO date, from `ClockPort`. Recorded on the calibration stub. */
  readonly date: string;
  /** Seed a starter review lens. Off by default: apparatus is earned, not sprayed. */
  readonly agentLens?: boolean;
  /** What the caller ASKED for. `block` is clamped — see rule 2 above. */
  readonly agentLensSeverity?: Check["severity"];
}

interface Draft {
  readonly id: string;
  readonly description: string;
  readonly kind: Check["kind"];
  readonly severity: Check["severity"];
  readonly tiers: readonly Check["tiers"][number][];
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly command?: string;
  readonly reviewLens?: string;
  readonly calibrationDate?: string;
  readonly body: string;
}

function render(draft: Draft): GeneratedFile {
  const lines: string[] = [
    "---",
    `id: ${draft.id}`,
    `description: ${yamlString(draft.description)}`,
    `kind: ${draft.kind}`,
    `severity: ${draft.severity}`,
    `tiers: ${yamlList(draft.tiers)}`,
    `include: ${yamlList(draft.include)}`,
  ];
  if (draft.exclude !== undefined && draft.exclude.length > 0) {
    lines.push(`exclude: ${yamlList(draft.exclude)}`);
  }
  if (draft.command !== undefined) lines.push(`command: ${yamlString(draft.command)}`);
  if (draft.reviewLens !== undefined) {
    lines.push(`review_lens: ${yamlBlock(draft.reviewLens)}`);
  }
  if (draft.calibrationDate !== undefined) {
    // No `status` field: it used to be what granted blocking authority, and it was
    // typed by hand. Authority now comes from a `<id>.calibration.json` receipt whose
    // hashes the loader recomputes. What is left here is a pointer to the fixtures
    // and a note, neither of which decides anything.
    lines.push(
      "calibration:",
      `  detail: ${yamlString(`seeded ${draft.calibrationDate}; never measured. Run \`wst calibrate\` before raising severity.`)}`,
    );
  }
  // Empty `origin` is the schema's word for "unearned". Seeded checks are exactly
  // that: nothing in this repo's history asked for them yet. The retro replaces
  // this with real signal ids the first time one of them catches something.
  lines.push("origin: []", "version: 1", "---", "", draft.body.trim(), "");

  return { path: `.sdd/checks/${draft.id}.md`, contents: lines.join("\n") };
}

export function seedChecks(
  stack: StackFacts,
  options: SeedChecksOptions,
): readonly GeneratedFile[] {
  const include = stack.sourceFileGlobs;
  // Without a source glob a check would have to declare `include: ["**"]`, which
  // matches build output and vendored code — and `**` does not cross a
  // dot-leading segment anyway, so it is not even the catch-all it looks like.
  if (include.length === 0) return [];

  const drafts: Draft[] = [];

  if (stack.commands.typecheck !== null) {
    drafts.push({
      id: "typecheck",
      description: "The project's typechecker reports no errors.",
      kind: "deterministic",
      severity: "block",
      tiers: ["strict", "light"],
      include,
      command: stack.commands.typecheck,
      body:
        "Seeded by \`wst init\` from the command this repo already declares — not from a " +
        "guess about what it might use.\n\n" +
        "A deterministic check may block freely: there is no ambiguity about whether the " +
        "compiler succeeded, so a failure here is never a matter of taste.\n\n" +
        "**When it fails:** fix the type, do not widen it. Reaching for an escape hatch to " +
        "get past this check defeats its purpose; if the type is genuinely unknowable, model " +
        "that explicitly and narrow at the boundary.",
    });
  }

  if (stack.commands.test !== null) {
    // A blocking test check in a repo with no tests blocks nothing today and
    // ambushes whoever writes the first one. Warn until tests actually exist,
    // and say in the file what promotes it.
    const severity: Check["severity"] = stack.hasTests ? "block" : "warn";
    drafts.push({
      id: "test",
      description: "The test suite passes.",
      kind: "deterministic",
      severity,
      tiers: ["strict", "light"],
      include,
      command: stack.commands.test,
      body:
        "Seeded by \`wst init\` from the test script this repo already declares.\n\n" +
        (stack.hasTests
          ? "This repo has tests, so the check blocks. A red suite is not a judgement call.\n\n"
          : "Held at `warn` because no test files were found at init. **Promote it to " +
            "`block` the day the first real test lands** — a blocking check over an empty " +
            "suite proves nothing and trains everyone to ignore it.\n\n") +
        "**When it fails:** read the failure before touching the test. Deleting, skipping " +
        "or loosening an assertion to get green is the one move this check exists to make " +
        "visible.",
    });
  }

  if (stack.commands.lint !== null) {
    drafts.push({
      id: "lint",
      description: "The linter reports no errors.",
      kind: "deterministic",
      severity: "warn",
      tiers: ["strict", "light"],
      include,
      command: stack.commands.lint,
      body:
        "Seeded by \`wst init\` from the lint script this repo already declares.\n\n" +
        "Held at `warn` deliberately. Lint rules encode taste as well as correctness, and a " +
        "gate that blocks a merge over a formatting preference gets routed around — after " +
        "which it stops catching the real findings too. Promote it once the ruleset is one " +
        "the team actually agrees with.\n\n" +
        "**When it fails:** fix it, or delete the rule. A permanently-warning check is " +
        "noise, and noise is what makes the signal unreadable.",
    });
  }

  if (options.agentLens === true) {
    drafts.push(agentLensDraft(stack, options));
  }

  return drafts.map(render);
}

/**
 * The starter review lens. `severity` is CLAMPED here: whatever the caller asked
 * for, a lens with no calibration receipt ships at `warn`. This is the one place
 * in init where an input is overridden rather than validated, and it is deliberate
 * — the alternative is a generated repo whose check registry refuses to load.
 */
function agentLensDraft(stack: StackFacts, options: SeedChecksOptions): Draft {
  const asked = options.agentLensSeverity ?? "warn";
  const severity: Check["severity"] = asked === "block" ? "warn" : asked;

  const testGlobs = ["**/*.test.*", "**/*.spec.*"];

  return {
    id: "correctness",
    description: "Does this diff introduce a correctness bug?",
    kind: "agent-lens",
    severity,
    tiers: ["strict"],
    include: stack.sourceFileGlobs,
    exclude: testGlobs,
    calibrationDate: options.date,
    reviewLens: [
      "You are a correctness review lens for a code gate. Decide whether this diff",
      "INTRODUCES a correctness bug.",
      "",
      "First identify the CONTRACT the changed code is meant to satisfy: its doc comment,",
      "type signature, error semantics, and any documented post-condition. Judge the change",
      "against that contract — not against how you would have written it.",
      "",
      "A verdict of 'fail' requires you to name a CONCRETE input, value, or interleaving",
      "that produces observably wrong behaviour under that contract. State it in your",
      "reason. If you cannot name one, the verdict is 'pass'.",
      "",
      "The following are NOT bugs: a different but equivalent idiom; a change that is",
      "stricter or looser in a way the contract permits; a style you would not have chosen;",
      "code that looks unusual but satisfies the documented behaviour.",
      "",
      "Judge only the change itself, not the surrounding file.",
    ].join("\n"),
    body:
      "Seeded by `wst init` as a starting point, and **uncalibrated** — nothing has measured " +
      "whether this lens agrees with itself, let alone with you.\n\n" +
      "**Why it cannot block.** A judgment check earns its `block` by being correct AND " +
      "unanimous across repeated runs on a known-good and a known-bad example. A fresh repo " +
      "has run it zero times, so the honest severity is `warn`. The failure mode that matters " +
      "is not a missed bug — it is crying wolf on correct work, because that is what gets the " +
      "gate routed around, and a routed-around gate has negative value.\n\n" +
      "**When it fails:** read the named input. If the lens cannot point at a concrete value " +
      "that misbehaves, the lens is wrong, not the code — record that, because a pattern of " +
      "false positives is the evidence that retires this check or rewrites its prompt.",
  };
}
