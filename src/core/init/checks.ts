/**
 * Seeding `.wst/checks/`.
 */

import type { Check } from "../checks/schema.js";
import { MAX_PERCENT } from "../checks/comment-density.js";
import { DEFINITION_DIR } from "../paths.js";
import { yamlBlock, yamlList, yamlString, type GeneratedFile } from "./artifact.js";
import type { StackFacts } from "./detect.js";

export interface SeedChecksOptions {
  /** ISO date, from `ClockPort`. Recorded on the calibration stub. */
  readonly date: string;
  /**
   * What every seeded check judges: the source globs the interview DECLARED
   * (ADR-0016). Used verbatim — narrowing a human's glob to a file-extension list
   * would put the guess back one layer down.
   */
  readonly include: readonly string[];
  /** Seed a starter review lens. Off by default: apparatus is earned, not sprayed. */
  readonly agentLens?: boolean;
  /** What the caller ASKED for. `block` is clamped; see rule 2 above. */
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
  /** Omitted means enabled. Written only to turn a check OFF, with the reason in the body. */
  readonly enabled?: false;
  /** Written only to REFUSE a receipt, where the answer depends on the range. */
  readonly skippable?: false;
  /** The signals that earned this rule elsewhere. Empty means nothing did. */
  readonly origin?: readonly string[];
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
  if (draft.enabled === false) lines.push("enabled: false");
  if (draft.skippable === false) lines.push("skippable: false");
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
  // Empty `origin` is the schema's word for "unearned": nothing in THIS repo's
  // history asked for the check yet, which is true of everything read off a
  // declared script. A rule Whetstone brings names the signal that earned it
  // somewhere else, and that field is the whole difference between the two.
  lines.push(`origin: ${yamlList(draft.origin ?? [])}`, "version: 1", "---", "", draft.body.trim(), "");

  return { path: `${DEFINITION_DIR}/checks/${draft.id}.md`, contents: lines.join("\n") };
}

export function seedChecks(
  stack: StackFacts,
  options: SeedChecksOptions,
): readonly GeneratedFile[] {
  const include = options.include;
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
        "Seeded by \`wst init\` from the command this repo already declares, not from a " +
        "guess about what it might use.\n\n" +
        "A deterministic check may block freely: there is no ambiguity about whether the " +
        "compiler succeeded, so a failure here is never a matter of taste.\n\n" +
        "**When it fails:** fix the type, do not widen it. Reaching for an escape hatch to " +
        "get past this check defeats its purpose; if the type is genuinely unknowable, model " +
        "that explicitly and narrow at the boundary.",
    });
  }

  if (stack.commands.test !== null) {
    // `init` has never seen this suite run, so it may not block on it.
    drafts.push({
      id: "test",
      description: "The test suite passes.",
      kind: "deterministic",
      severity: "warn",
      tiers: ["strict", "light"],
      include,
      command: stack.commands.test,
      body:
        "Seeded by \`wst init\` from the test script this repo already declares.\n\n" +
        (stack.hasTests
          ? "Held at `warn` because **`init` has not seen this suite pass.** Test files exist, " +
            "which is not the same thing: a suite can need a database, a fixture server or an " +
            "env var that nobody has here. **Promote it to `block` after the first green " +
            "gate.** That run is the evidence this seeding cannot have.\n\n"
          : "Held at `warn` because no test files were found at init. **Promote it to " +
            "`block` after the first green gate.** A blocking check over an empty " +
            "suite proves nothing and trains everyone to ignore it.\n\n") +
        "**When it fails:** read the failure before touching the test. Deleting, skipping " +
        "or loosening an assertion to get green is the one move this check exists to make " +
        "visible.",
    });
  }

  if (stack.commands.lint !== null) {
    // A command carrying `--fix` REWRITES the tree while judging it: it reports on
    // a file that no longer exists in the form the author wrote it, and it hides
    // the finding it was meant to surface.
    const mutates = stack.mutating.includes("lint");
    drafts.push({
      id: "lint",
      description: "The linter reports no errors.",
      kind: "deterministic",
      severity: "warn",
      tiers: ["strict", "light"],
      include,
      command: stack.commands.lint,
      ...(mutates ? { enabled: false as const } : {}),
      body:
        "Seeded by \`wst init\` from the lint script this repo already declares.\n\n" +
        (mutates
          ? "**Seeded OFF: this command rewrites the tree it is judging.** The script " +
            "carries a write flag (`--fix`, `--write`, `-w`), so running it inside the gate " +
            "reports on a file that no longer matches what the author wrote, and hides the " +
            "finding it was meant to surface. `init` cannot strip the flag, which lives in " +
            "this repo's own script.\n\n" +
            "**To turn it on:** point `command:` at a read-only invocation (`eslint .` " +
            "rather than `eslint --fix .`), then delete `enabled: false`.\n\n"
          : "") +
        "Held at `warn` deliberately. Lint rules encode taste as well as correctness, and a " +
        "gate that blocks a merge over a formatting preference gets routed around, after " +
        "which it stops catching the real findings too. Promote it once the ruleset is one " +
        "the team actually agrees with.\n\n" +
        "**When it fails:** fix it, or delete the rule. A permanently-warning check is " +
        "noise, and noise is what makes the signal unreadable.",
    });
  }

  if (options.agentLens === true) {
    drafts.push(agentLensDraft(options));
  }

  // LAST, and only where a typecheck script was declared: the runner reads `.ts`
  // and nothing else, so seeding it beside a Python repo writes a check that can
  // never see a file. adr-0016 allows this, since a declared script is a fact and
  // not a guess off file extensions.
  if (stack.commands.typecheck !== null) drafts.push(commentDensityDraft(include));

  return drafts.map(render);
}

/**
 * The starter review lens. `severity` is CLAMPED here: whatever the caller asked
 * for, a lens with no calibration receipt ships at `warn`. This is the one place
 * in init where an input is overridden rather than validated, and it is deliberate
 * — the alternative is a generated repo whose check registry refuses to load.
 */
function agentLensDraft(options: SeedChecksOptions): Draft {
  const asked = options.agentLensSeverity ?? "warn";
  const severity: Check["severity"] = asked === "block" ? "warn" : asked;

  const testGlobs = ["**/*.test.*", "**/*.spec.*"];

  return {
    id: "correctness",
    description: "Does this diff introduce a correctness bug?",
    kind: "llm",
    severity,
    tiers: ["strict"],
    include: options.include,
    exclude: testGlobs,
    calibrationDate: options.date,
    reviewLens: [
      "You are a correctness review lens for a code gate. Decide whether this diff",
      "INTRODUCES a correctness bug.",
      "",
      "First identify the CONTRACT the changed code is meant to satisfy: its doc comment,",
      "type signature, error semantics, and any documented post-condition. Judge the change",
      "against that contract, not against how you would have written it.",
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
      "Seeded by `wst init` as a starting point, and **uncalibrated**: nothing has measured " +
      "whether this lens agrees with itself, let alone with you.\n\n" +
      "**Why it cannot block.** A judgment check earns its `block` by being correct AND " +
      "unanimous across repeated runs on a known-good and a known-bad example. A fresh repo " +
      "has run it zero times, so the honest severity is `warn`. The failure mode that matters " +
      "is not a missed bug; it is crying wolf on correct work, because that is what gets the " +
      "gate routed around, and a routed-around gate has negative value.\n\n" +
      "**When it fails:** read the named input. If the lens cannot point at a concrete value " +
      "that misbehaves, the lens is wrong, not the code. Record that, because a pattern of " +
      "false positives is the evidence that retires this check or rewrites its prompt.",
  };
}


/**
 * The one rule Whetstone brings rather than reads (adr-0030).
 *
 * It is `enabled: false`. A repo that gains a check nobody asked for is the "pile
 * of config from guesses" adr-0016 exists to prevent, and a check that never runs
 * cannot be that. What it is instead is an offer sitting where the friction will
 * be felt, rather than a question asked on the day the answer is "I do not know
 * yet".
 */
function commentDensityDraft(include: readonly string[]): Draft {
  return {
    id: "comment-density",
    description: "A change adds more code than commentary about it.",
    kind: "deterministic",
    // Earned somewhere else. It stays off until somebody here wants it, and it
    // stays at `warn` after that until it has caught something.
    severity: "warn",
    tiers: ["strict", "light"],
    include,
    command: "wst check run comment-density",
    enabled: false,
    // The answer depends on the range, not on the contents of a file, so a
    // receipt from an earlier run proves nothing about this one.
    skippable: false,
    origin: ["sig-4a2610fb"],
    body:
      "**Seeded OFF.** Nothing in this repo asked for it. It is here because it was earned " +
      "elsewhere and it is as true in a payments API as it was there: a rule stated twice, " +
      "applied by hand once, and back two days later on a branch written by the same person " +
      "who applied it. Nothing held it, which is `sig-4a2610fb`.\n\n" +
      "**To turn it on:** delete `enabled: false`. It reads `.ts` files only.\n\n" +
      "Comments belong where the code cannot be made clear on its own. History, a rejected " +
      "alternative, and what a module used to do belong in the commit body or in the " +
      "decision record. A comment that recounts a change is stale the moment the next one " +
      "lands.\n\n" +
      "**It reads the diff, not the tree.** One branch at 33% moves a repo average by a " +
      "tenth of a point and passes, so the rule is not expressible over a whole checkout.\n\n" +
      `**The ceiling was measured, not chosen**, over thirty commits of the repo this came ` +
      `from: 19, 20, 21, 22, 29, 30, 39, 39, 47. ${String(MAX_PERCENT)} sits in the gap. Move it here, ` +
      "where the next reader can see that you did.\n\n" +
      "**What it refuses to judge:** a change with fewer than fifteen added lines, and one " +
      "that removes at least as many comment lines as it adds in the files it also added to. " +
      "Without the second, a commit that CLEANS comments scores 100%.\n\n" +
      "**When it fails:** cut the commentary, do not raise the ceiling. If the comment is " +
      "the only thing making the code readable, the code is what needs the change.",
  };
}
