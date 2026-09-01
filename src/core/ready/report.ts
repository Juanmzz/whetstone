/**
 * What `wst ready` tells a person, and the envelope it tells a machine. PURE.
 *
 * The report has to be checkable after the fact. `ready` chose its own scope, so
 * the one thing it owes a reader is exactly what it compared: the base ref, the
 * commit that ref resolved to, and which files came from where.
 */

import { saidAs, type Readiness } from "./result.js";

export type ResultStatus = "pass" | "fail" | "errored" | "skipped" | "n/a";

export interface CheckLine {
  readonly id: string;
  readonly status: ResultStatus;
  readonly ms: number;
  /** What it said, for the two statuses a reader has to act on. */
  readonly detail?: string;
}

export interface ReadyFacts {
  readonly repo: string;
  readonly branch: string;
  /** `commit` is null where the base is a range, which resolves to no single one. */
  readonly base: { readonly ref: string; readonly how: string; readonly commit: string | null };
  /** Split, never totalled: a forgotten `git add` is only visible in the breakdown. */
  readonly committed: readonly string[];
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly tier: string;
  readonly applicable: readonly string[];
  readonly results: readonly CheckLine[];
  readonly uncovered: readonly string[];
  readonly evidence: readonly string[];
  readonly elapsedMs: number;
  readonly readiness: Readiness;
}

/**
 * The first line of a check's output that says something.
 *
 * npm prints its own banner before the script runs, so the first line of a failure
 * is `> pkg@1.0.0 check:docs` and tells a reader nothing. Skipping it is the
 * difference between a report that names the problem and one that names npm.
 */
export function firstMeaningfulLine(detail: string): string {
  for (const line of detail.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(">")) continue;
    return trimmed;
  }
  return "";
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

function paths(label: string, list: readonly string[]): string[] {
  if (list.length === 0) return [];
  const shown = list.slice(0, 10);
  const more = list.length > shown.length ? `, and ${String(list.length - shown.length)} more` : "";
  return [`  ${label.padEnd(11)} ${shown.join(", ")}${more}`];
}

const MARK: Readonly<Record<ResultStatus, string>> = {
  pass: "pass ",
  fail: "FAIL ",
  errored: "ERROR",
  skipped: "skip ",
  "n/a": "n/a  ",
};

export function renderReady(facts: ReadyFacts): string {
  const lines: string[] = [
    "",
    `  ${saidAs(facts.readiness)}`,
    "",
    `  repo        ${facts.repo}`,
    `  branch      ${facts.branch}`,
    // Both where there are two. A ref moves, so the commit is what was actually
    // compared; a range resolves to no single commit and truncating it to eight
    // characters printed `main..HE`.
    `  base        ${facts.base.ref}${facts.base.commit === null ? "" : ` at ${facts.base.commit}`} (${facts.base.how})`,
    "",
  ];

  const changed =
    facts.committed.length + facts.staged.length + facts.unstaged.length + facts.untracked.length;
  if (changed === 0) {
    lines.push("  nothing changed against that base, so there was nothing to verify", "");
  } else {
    lines.push(
      ...paths("committed", facts.committed),
      ...paths("staged", facts.staged),
      ...paths("unstaged", facts.unstaged),
      ...paths("untracked", facts.untracked),
      "",
      `  tier        ${facts.tier}`,
      "",
    );
  }

  for (const r of facts.results) {
    const why = r.detail === undefined ? "" : `  ${r.detail}`;
    const said = r.status === "errored" ? `${MARK[r.status]} ${r.id.padEnd(16)} could not run` : `${MARK[r.status]} ${r.id.padEnd(16)}`;
    lines.push(`  ${said} ${seconds(r.ms).padStart(6)}${why}`);
  }
  if (facts.results.length > 0) lines.push("");

  if (facts.uncovered.length > 0) {
    lines.push("  no check covers these paths, so nothing verified them:", ...paths("", facts.uncovered), "");
  }
  if (facts.evidence.length > 0) {
    lines.push(`  evidence required: ${facts.evidence.join(", ")}`, "");
  }

  lines.push(`  ${seconds(facts.elapsedMs)}`);
  return lines.join("\n");
}
