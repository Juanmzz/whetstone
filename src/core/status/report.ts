/**
 * `wst status`. PURE — the command gathers facts through ports, this decides what
 * they mean.
 *
 * Scope note: this deliberately does NOT parse `.sdd/` — it only checks that the
 * directory exists. The loader is Step 1; reaching for it here would drag the
 * check-registry schema into the skeleton before that schema is decided.
 */

/** The `claude` build the adapter's flag set was measured against. */
export const VALIDATED_JUDGE_VERSION = "2.1.224";

export interface StatusFacts {
  readonly repoRoot: string | null;
  readonly branch: string | null;
  readonly sddPresent: boolean;
  readonly judge: { readonly name: string; readonly version: string | null };
  readonly nodeVersion: string;
}

export interface StatusReport {
  readonly facts: StatusFacts;
  readonly ready: boolean;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

export function buildStatusReport(facts: StatusFacts): StatusReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (facts.repoRoot === null) {
    problems.push("not inside a git repository — Whetstone is git-native by design");
  }
  if (!facts.sddPresent) {
    problems.push("no .sdd/ directory — run `wst init` to create one");
  }
  if (facts.judge.version === null) {
    problems.push(
      `\`${facts.judge.name}\` not found on PATH — agent-lens checks cannot run without it`,
    );
  } else if (facts.judge.version !== VALIDATED_JUDGE_VERSION) {
    warnings.push(
      `${facts.judge.name} ${facts.judge.version} differs from the version the adapter was ` +
        `validated against (${VALIDATED_JUDGE_VERSION}); re-run \`npm run calibrate\` if verdicts look wrong`,
    );
  }

  return { facts, ready: problems.length === 0, problems, warnings };
}

export function renderStatusReport(
  report: StatusReport,
  options: { readonly quiet?: boolean } = {},
): string {
  if (options.quiet) {
    return report.ready ? "ready" : "NOT ready";
  }

  const { facts } = report;
  const lines = [
    "whetstone — status",
    "",
    `  repo      ${facts.repoRoot ?? "(not a git repository)"}`,
    `  branch    ${facts.branch ?? "(none)"}`,
    `  .sdd/     ${facts.sddPresent ? "present" : "missing"}`,
    `  judge     ${facts.judge.name} ${facts.judge.version ?? "(not found)"}`,
    `  node      ${facts.nodeVersion}`,
    "",
    `  ${report.ready ? "ready" : "NOT ready"}`,
  ];
  for (const w of report.warnings) lines.push(`  warn   ${w}`);
  for (const p of report.problems) lines.push(`  blocked  ${p}`);
  return lines.join("\n");
}
