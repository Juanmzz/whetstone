/**
 * ADR-0004, enforced instead of remembered.
 *
 * Everything `init` writes travels into someone else's repository. A generated
 * sentence that says "see `docs/PARALLEL.md`" or "copy the skills from
 * Whetstone's `.wst/skills/`" produces a reference to a file that does not exist
 * there. The reader — usually an agent — then either invents the missing content
 * or drops the rule, and both failures are silent.
 *
 * This is not hypothetical. It has already happened in this project: a shipped
 * skill cited `OPEN_QUESTIONS.md`, a Whetstone-only file. The Wizard-of-Oz
 * `AGENTS.md` template carries the same bug today, telling the target repo to
 * "run the retro (see `retro.md`)" — a document that only exists here.
 *
 * Two rules, and the second is the one that keeps working as the payload grows:
 *
 * 1. **Deny-list.** Named Whetstone-only artefacts, and possessive references to
 *    its tree. Catches the cases a generic rule cannot see.
 * 2. **Reference closure.** Every `.wst/…` and `.claude/…` path mentioned in
 *    generated content must be a path the plan actually creates. This one needs no
 *    maintenance: add a reference to a file init stopped writing and it fails on
 *    its own, which is exactly what a hand-maintained list never does.
 */

import { DEFINITION_DIR, DEFINITION_DIR_PATTERN } from "../paths.js";
import type { CopyRequest, GeneratedFile } from "./artifact.js";

export interface SelfContainmentViolation {
  /** Generated file the violation is in. */
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  /** The offending text. */
  readonly match: string;
  readonly why: string;
}

interface DenyRule {
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Whetstone-only artefacts. Everything here is a file that exists in THIS repo and
 * will not exist in a bootstrapped one.
 */
const DENY: readonly DenyRule[] = [
  {
    pattern: /docs\/[A-Za-z0-9_.-]+\.md/g,
    why: "a file under Whetstone's own `docs/` — it does not exist in a bootstrapped repo",
  },
  {
    pattern: /\bOPEN_QUESTIONS\.md\b/g,
    why: "a Whetstone working document; the exact reference that dangled once already",
  },
  {
    // Bare, without the directory. The `docs/` rule above catches the qualified
    // form; this catches "see PARALLEL.md", which is the way prose usually cites
    // it. Kept apart so a qualified mention is reported once, not twice.
    pattern: /(?<!\/)\bPARALLEL\.md\b/g,
    why: "Whetstone's lane brief for its own contributors",
  },
  {
    // `adr-0000` is deliberately absent: it is the id a target repo's first
    // decision takes, so a payload naming it is teaching, not citing.
    pattern: /\b[Aa][Dd][Rr]-(?!0000\b)\d{4}\b/g,
    why:
      "a decision id from WHETSTONE's record. A bootstrapped repo's decision page starts " +
      "empty, so the citation resolves to nothing — state the rule instead of pointing at it",
  },
  {
    pattern: /\bSPEC\s*§\s*[\d.]+/g,
    why: "a section of Whetstone's own SPEC, which does not travel",
  },
  // DELIBERATELY ABSENT: `sig-NNNN`. A signal id in the payload is never a
  // pointer a reader is expected to follow — it appears as a label beside its
  // own description ("`sig-0002` (the emitter wrote both files byte-identical)"),
  // so the sentence still carries its meaning where the id resolves to nothing.
  // A decision id is the opposite: "per `adr-0001`" is only the pointer.
  {
    pattern: /\blanes\.yaml\b/g,
    why: "Whetstone's own lane ownership file",
  },
  {
    pattern: /(?<![\w/])(?:retro|init)\.md\b/g,
    why:
      "the Wizard-of-Oz playbooks live in Whetstone, not in the target repo — describe the " +
      "procedure inline instead of linking to it",
  },
  {
    pattern: /\bVISION\.md\b/g,
    why: "Whetstone's own product thesis",
  },
  {
    pattern: /scripts\/calibrate\.ts/g,
    why: "Whetstone's calibration harness, which does not ship with the payload",
  },
  {
    pattern: /Whetstone's\s+\S+/g,
    why:
      "a possessive reference to Whetstone's own tree. The payload must stand alone: restate " +
      "what the target repo needs rather than pointing back at the generator",
  },
];

/** Path-shaped tokens the plan is responsible for. */
const OWNED_PATH = new RegExp(
  `(?:${DEFINITION_DIR_PATTERN}|\\.claude)/[A-Za-z0-9_@\\-./*<>{}]*`,
  "g",
);

/** Trailing prose punctuation swept up by the token regex. */
function trimTrailing(token: string): string {
  return token.replace(/[.,;:)\]`'"]+$/, "");
}

export interface AuditInput {
  readonly files: readonly GeneratedFile[];
  readonly copies: readonly CopyRequest[];
  /**
   * Paths already in the target repo that this run leaves alone, repo-relative.
   *
   * Reference closure asks whether a named path will EXIST there, and "this run
   * wrote it" was standing in for that. The two came apart the first time
   * `AGENTS.md` listed a skill somebody had written by hand: the file is there,
   * init does not create it, and the audit called a live reference dangling.
   */
  readonly existing?: readonly string[];
}

export function auditSelfContained(input: AuditInput): readonly SelfContainmentViolation[] {
  const created = new Set<string>([
    ...input.files.map((f) => f.path),
    ...input.copies.map((c) => c.to),
    ...(input.existing ?? []),
  ]);

  const violations: SelfContainmentViolation[] = [];

  // Generated files, then the copies. A copied skill is prose written for THIS
  // repo and shipped unchanged into another one, which makes it the likeliest
  // place for a dangling reference — and it was the one place this never read.
  const audited: readonly GeneratedFile[] = [
    ...input.files,
    ...input.copies.flatMap((copy) =>
      copy.contents === undefined ? [] : [{ path: copy.to, contents: copy.contents }],
    ),
  ];

  for (const file of audited) {
    const lines = file.contents.split("\n");
    lines.forEach((text, index) => {
      const line = index + 1;

      for (const rule of DENY) {
        // Fresh lastIndex per line: these are /g regexes shared across files.
        rule.pattern.lastIndex = 0;
        for (const match of text.matchAll(rule.pattern)) {
          violations.push({ path: file.path, line, match: match[0], why: rule.why });
        }
      }

      OWNED_PATH.lastIndex = 0;
      for (const match of text.matchAll(OWNED_PATH)) {
        const token = trimTrailing(match[0]);
        // A directory, a glob or a `<placeholder>` names a shape, not a file.
        if (token.endsWith("/") || /[*<>{}]/.test(token)) continue;
        // `.wst` or `.claude` on their own refer to the directory itself.
        if (token === DEFINITION_DIR || token === ".claude") continue;
        if (created.has(token)) continue;
        violations.push({
          path: file.path,
          line,
          match: token,
          why:
            `references \`${token}\`, which this init does not create. In the target repo ` +
            `that path does not exist, so the reference dangles.`,
        });
      }
    });
  }

  return violations;
}

/**
 * Copies whose text never arrived, so nothing about them was verified.
 *
 * Deliberately NOT a violation. A dangling reference is a defect in the payload;
 * an unread file is the audit failing to run, and merging the two would either
 * block a legitimate init (a published package without its skills) or let
 * "nothing was examined" render as "nothing was wrong" — hard rule 3, at the
 * level of one audit.
 */
export function unauditedCopies(copies: readonly CopyRequest[]): readonly string[] {
  return copies.filter((c) => c.contents === undefined).map((c) => c.to);
}

/** One readable block, for a thrown error or a CLI report. */
export function formatViolations(violations: readonly SelfContainmentViolation[]): string {
  return violations
    .map((v) => `  ${v.path}:${v.line}  ${JSON.stringify(v.match)}\n      ${v.why}`)
    .join("\n");
}
