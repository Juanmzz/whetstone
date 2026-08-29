/**
 * What a commit message has to say for itself. PURE.
 *
 * Two rules, and both were measured over this repo's own 333 commits before
 * being written: the conventional subject holds in 332 of them, and the
 * attribution trailer appears in four. Nothing here judges LENGTH or whether a
 * body exists, because on those two the repo does the opposite of the rule.
 */

/** The conventional set, and every type this repo has actually used is in it. */
export const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const;

export interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

export type FindingKind = "not-conventional" | "unknown-type" | "ai-attribution";

export interface Finding {
  readonly kind: FindingKind;
  readonly sha: string;
  readonly detail: string;
}

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^()]+)\))?!?: (?<rest>.+)$/;

/**
 * Attribution, not mention.
 *
 * Five of the nine lines naming the tool in this repo's history are prose ABOUT
 * it, in commits that describe the plugin and the hook. A pattern that cannot
 * tell "Co-Authored-By: Claude" from "the Claude Code skill" makes the subject
 * undiscussable in its own commit messages.
 */
const AI = /claude|anthropic|copilot|cursor|chatgpt|\bgpt-/i;
const COAUTHOR = /^\s*co-authored-by:\s*(?<who>.+)$/i;
const GENERATED = /^\s*\S*\s*generated with\b/i;

function attribution(body: string): string | null {
  for (const line of body.split("\n")) {
    const who = COAUTHOR.exec(line)?.groups?.["who"];
    if (who !== undefined && AI.test(who)) return line.trim();
    if (GENERATED.test(line) && AI.test(line)) return line.trim();
  }
  return null;
}

export function judgeCommits(commits: readonly Commit[]): Finding[] {
  const found: Finding[] = [];

  for (const { sha, subject, body } of commits) {
    const match = CONVENTIONAL.exec(subject);
    if (match === null) {
      found.push({
        kind: "not-conventional",
        sha,
        detail: `${subject}\n  wanted type(scope): description, as in "fix(banner): draw the mark"`,
      });
    } else {
      const type = match.groups?.["type"] ?? "";
      if (!(TYPES as readonly string[]).includes(type)) {
        found.push({
          kind: "unknown-type",
          sha,
          detail: `${subject}\n  "${type}" is not one of: ${TYPES.join(", ")}`,
        });
      }
    }

    const credited = attribution(body);
    if (credited !== null) {
      found.push({
        kind: "ai-attribution",
        sha,
        detail: `${credited}\n  the commit carries the author's name; a model is not a co-author of it`,
      });
    }
  }

  return found;
}
