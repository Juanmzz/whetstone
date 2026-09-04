/**
 * Seeding `.wst/checks/`.
 */

import type { Check } from "../checks/schema.js";
import { MAX_PERCENT } from "../checks/comment-density.js";
import { DEFINITION_DIR } from "../paths.js";
import { yamlBlock, yamlList, yamlString, type GeneratedFile } from "./artifact.js";
import type { StackFacts } from "./detect.js";
import { probeNote, severityFor, type Probes } from "./probe.js";

export interface SeedChecksOptions {
  /** ISO date, from `ClockPort`. Recorded on the calibration stub. */
  readonly date: string;
  /**
   * What every seeded check judges: the source globs the interview DECLARED
   * (ADR-0016). Used verbatim — narrowing a human's glob to a file-extension list
   * would put the guess back one layer down.
   */
  readonly include: readonly string[];
  /**
   * What the repo's own commands did when `init` ran them. A green run is what a
   * seeded `block` rests on; absent means nothing was measured, which is `warn`.
   */
  readonly probes?: Probes;
  /**
   * Ids to seed with `enabled: false`, from the plan screen. A check turned off
   * where the offer was made is one somebody saw and declined, which is not the
   * same as one that arrived off and was never read.
   */
  readonly disabled?: readonly string[];
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
      severity: severityFor(options.probes?.["typecheck"]),
      tiers: ["strict", "light"],
      include,
      command: stack.commands.typecheck,
      body:
        "Seeded by \`wst init\` from the command this repo already declares, not from a " +
        "guess about what it might use.\n\n" +
        `${probeNote(options.probes?.["typecheck"], options.date)}\n\n` +
        "A deterministic check may block freely: there is no ambiguity about whether the " +
        "compiler succeeded, so a failure here is never a matter of taste.\n\n" +
        "**When it fails:** fix the type, do not widen it. Reaching for an escape hatch to " +
        "get past this check defeats its purpose; if the type is genuinely unknowable, model " +
        "that explicitly and narrow at the boundary.",
    });
  }

  if (stack.commands.test !== null) {
    drafts.push({
      id: "test",
      description: "The test suite passes.",
      kind: "deterministic",
      severity: severityFor(options.probes?.["test"]),
      tiers: ["strict", "light"],
      include,
      command: stack.commands.test,
      body:
        "Seeded by \`wst init\` from the test script this repo already declares.\n\n" +
        `${probeNote(options.probes?.["test"], options.date)}\n\n` +
        (stack.hasTests
          ? ""
          : "No test files were found at init. A blocking check over an empty suite proves " +
            "nothing and trains everyone to ignore it, so look at what it actually ran.\n\n") +
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
      severity: mutates ? "warn" : severityFor(options.probes?.["lint"]),
      tiers: ["strict", "light"],
      include,
      command: stack.commands.lint,
      ...(mutates ? { enabled: false as const } : {}),
      body:
        "Seeded by \`wst init\` from the lint script this repo already declares.\n\n" +
        (mutates ? "" : `${probeNote(options.probes?.["lint"], options.date)}\n\n`) +
        (mutates
          ? "**Seeded OFF: this command rewrites the tree it is judging.** The script " +
            "carries a write flag (`--fix`, `--write`, `-w`), so running it inside the gate " +
            "reports on a file that no longer matches what the author wrote, and hides the " +
            "finding it was meant to surface. `init` cannot strip the flag, which lives in " +
            "this repo's own script.\n\n" +
            "**To turn it on:** point `command:` at a read-only invocation (`eslint .` " +
            "rather than `eslint --fix .`), then delete `enabled: false`.\n\n"
          : "") +
        "Lint rules encode taste as well as correctness. A gate that blocks a merge over a " +
        "formatting preference gets routed around, after which it stops catching the real " +
        "findings too. If that is this ruleset, drop it back to `warn` and say so here.\n\n" +
        "**When it fails:** fix it, or delete the rule. A permanently-warning check is " +
        "noise, and noise is what makes the signal unreadable.",
    });
  }

  if (options.agentLens === true) {
    drafts.push(agentLensDraft(options));
  }

  // The two rules Whetstone BROUGHT are no longer seeded. adr-0030 argued they were
  // an offer sitting where the friction would be felt; a repo installing
  // verification for the first time has felt no friction yet, and what it gets is
  // its own declared scripts, checked. Both remain in this repo's own registry.

  const off = new Set(options.disabled ?? []);
  return drafts.map((d) => render(off.has(d.id) ? { ...d, enabled: false } : d));
}

export interface SeededCheck {
  readonly id: string;
  readonly severity: Check["severity"];
}

/** What the plan screen offers, so the offer and what is written cannot drift. */
export function seededChecks(
  stack: StackFacts,
  options: SeedChecksOptions,
): readonly SeededCheck[] {
  return seedChecks(stack, { ...options, disabled: [] }).map((file) => {
    const contents = file.contents;
    return {
      id: /^id: (.+)$/m.exec(contents)?.[1] ?? "",
      severity: (/^severity: (.+)$/m.exec(contents)?.[1] ?? "warn") as Check["severity"],
    };
  });
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
 * It arrives ON, at `warn`. It used to arrive `enabled: false` so that a repo
 * gained no check nobody asked for, which is the "pile of config from guesses"
 * adr-0016 prevents. What that produced instead was a rule nobody ever saw: an
 * offer in a file, waiting to be found. `init` shows the checks it is about to
 * seed in the plan, before it writes, so the offer is made where it can be
 * declined and the default no longer has to be off.
 */
function commentDensityDraft(include: readonly string[]): Draft {
  return {
    id: "comment-density",
    description: "A change adds more code than commentary about it.",
    kind: "deterministic",
    // Earned somewhere else, so it starts at `warn` here until it has caught
    // something in THIS repo.
    severity: "warn",
    tiers: ["strict", "light"],
    include,
    command: "wst check run comment-density",
    // The answer depends on the range, not on the contents of a file, so a
    // receipt from an earlier run proves nothing about this one.
    skippable: false,
    origin: ["sig-4a2610fb"],
    body:
      "**Seeded at `warn`.** Nothing in this repo asked for it. It is here because it was " +
      "earned elsewhere and it is as true in a payments API as it was there: a rule stated twice, " +
      "applied by hand once, and back two days later on a branch written by the same person " +
      "who applied it. Nothing held it, which is `sig-4a2610fb`.\n\n" +
      "It reads `.ts` files only. To switch it off, add `enabled: false`.\n\n" +
      "Comments belong where the code cannot be made clear on its own. History, a rejected " +
      "alternative, and what a module used to do belong in the pull request description or " +
      "in the decision record. A comment that recounts a change is stale the moment the " +
      "next one lands.\n\n" +
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

/**
 * The second rule Whetstone brings rather than reads (adr-0030).
 *
 * On at `warn`, like the first, and for the same reason: an offer nobody sees is
 * not an offer. The plan screen shows it before `init` writes anything.
 */
function commitMessageDraft(include: readonly string[]): Draft {
  return {
    id: "commit-message",
    description:
      "A commit names its kind in a conventional subject, and credits nobody who did not write it.",
    kind: "deterministic",
    severity: "warn",
    tiers: ["strict", "light"],
    include,
    command: "wst check run commit-message",
    // The same tree over two ranges is two different sets of messages.
    skippable: false,
    origin: [],
    body:
      "**Seeded at `warn`.** Nothing in this repo asked for it. Add `enabled: false` to " +
      "switch it off.\n\n" +
      "**The subject is conventional.** `type(scope): description`, with a type from the " +
      "standard set. Measured where this came from: 332 of 333 commits already matched, so " +
      "it holds a rule rather than introducing one.\n\n" +
      "**No commit credits a model.** A `Co-Authored-By:` naming an assistant, or the " +
      "`Generated with` footer. The commit carries the author's name, and a model is not a " +
      "co-author of it.\n\n" +
      "**It matches attribution, not mention.** Of the nine lines naming the tool where this " +
      "came from, five were prose ABOUT it. A pattern that cannot tell `Co-Authored-By: " +
      "Claude` from \"the Claude Code skill\" makes the subject undiscussable in the messages " +
      "that discuss it.\n\n" +
      "**What it does NOT judge:** subject length, and whether a body exists. Both are house " +
      "style rather than measurable defects, and where this came from the repo did the " +
      "opposite of its own rule on each: 10 of the last 60 subjects ran past 72 characters " +
      "and 23 of them carried a prose body. A check that blocks a third of what a repo " +
      "actually does teaches `--no-verify`. Decide those yourself and add them here.\n\n" +
      "**It reads the range, not the tree**, so no receipt stands in for it.\n\n" +
      "**Its `include` is this repo's source layout, and that is a compromise.** A commit " +
      "always has a message, so this would run on every change; the registry selects by " +
      "changed PATH and has no way to say `always`. Scoped like this, a commit touching only " +
      "documentation is not checked. Widen the globs if that matters to you.\n\n" +
      "**When it fails:** amend the message. `git commit --amend` for the last one, an " +
      "interactive rebase for anything older. The rationale a long body wanted to carry " +
      "belongs in the pull request description, where a reader looking at the change will " +
      "actually find it.",
  };
}
