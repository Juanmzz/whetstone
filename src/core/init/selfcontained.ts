/**
 * ADR-0004, enforced instead of remembered.
 *
 * Everything `init` writes travels into someone else's repository. A generated
 * sentence that says "see `docs/woz/SPEC.md`" or "copy the skills from
 * Whetstone's `.sdd/skills/`" produces a reference to a file that does not exist
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
 * 2. **Reference closure.** Every `.sdd/…` and `.claude/…` path mentioned in
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
    pattern: /docs\/woz\/[A-Za-z0-9_.-]*/g,
    why: "Whetstone's Wizard-of-Oz reference docs — they do not exist in a bootstrapped repo",
  },
  {
    pattern: /\bOPEN_QUESTIONS\.md\b/g,
    why: "a Whetstone working document; the exact reference that dangled once already",
  },
  {
    pattern: /\bPARALLEL\.md\b/g,
    why: "Whetstone's lane brief for its own contributors",
  },
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
}

export function auditSelfContained(input: AuditInput): readonly SelfContainmentViolation[] {
  const created = new Set<string>([
    ...input.files.map((f) => f.path),
    ...input.copies.map((c) => c.to),
  ]);

  const violations: SelfContainmentViolation[] = [];

  for (const file of input.files) {
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
        // `.sdd` or `.claude` on their own refer to the directory itself.
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

/** One readable block, for a thrown error or a CLI report. */
export function formatViolations(violations: readonly SelfContainmentViolation[]): string {
  return violations
    .map((v) => `  ${v.path}:${v.line}  ${JSON.stringify(v.match)}\n      ${v.why}`)
    .join("\n");
}
