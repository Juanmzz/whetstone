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
  readonly hooks: HookFacts;
}

/** Where Whetstone's hooks live, when it owns them. */
export const WHETSTONE_HOOKS_PATH = ".githooks";

/**
 * git has exactly ONE `core.hooksPath`, so husky, lefthook and Whetstone are
 * mutually exclusive: setting one unsets the others.
 *
 * This used to be a single boolean, `hooksInstalled`, computed as
 * `hooksPath === ".githooks"`. That collapsed three different situations into one
 * answer — nothing configured, another tool configured, and Whetstone configured —
 * so a repo on `.husky` reported identically to a repo with no hooks at all and got
 * told to run `git config core.hooksPath .githooks`. Following that disarms husky.
 */
export interface HookFacts {
  /** The configured `core.hooksPath`, verbatim, or `null` when unset. */
  readonly configuredPath: string | null;
  /** Whether a `.githooks/` directory actually exists to be pointed at. */
  readonly whetstoneHooksPresent: boolean;
}

/** Whether the pre-push gate is actually in the path. */
export const hooksArmed = (hooks: HookFacts): boolean =>
  hooks.configuredPath === WHETSTONE_HOOKS_PATH;

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
  }

  // A gate that only runs when invoked is a gate that will be forgotten. Always a
  // warning, never a problem: a fresh clone is not broken, it is just unarmed — and
  // a repo that deliberately uses husky is not broken either.
  if (!hooksArmed(facts.hooks)) {
    const { configuredPath, whetstoneHooksPresent } = facts.hooks;

    if (configuredPath !== null) {
      // Another tool owns hooks. Say so and STOP — no command to copy-paste. There
      // is one `core.hooksPath`, so any instruction we could give here silently
      // disarms whatever is already protecting this repo, and choosing that for
      // someone is not `status`'s call. It reports; the human decides.
      warnings.push(
        `the pre-push gate is not active, and \`${configuredPath}\` already owns ` +
          `core.hooksPath — git allows only one, so arming Whetstone would disable it. ` +
          `Chain the gate from the existing hook, or move deliberately; status will not ` +
          `hand you a command that disarms something you set up on purpose`,
      );
    } else if (!whetstoneHooksPresent) {
      // Pointing git at a directory that does not exist installs nothing, and if
      // anything had been configured it would now be gone. Never suggest it.
      warnings.push(
        `the pre-push gate is not active, and there is no \`${WHETSTONE_HOOKS_PATH}/\` ` +
          `directory to point git at — create the hook first, then arm it`,
      );
    } else {
      warnings.push(
        `the pre-push gate is not active — run \`git config core.hooksPath ${WHETSTONE_HOOKS_PATH}\``,
      );
    }
  }

  if (facts.judge.version !== null && facts.judge.version !== VALIDATED_JUDGE_VERSION) {
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
    // Names the owner when it is not us. "NOT active" alone reads as "nothing is
    // guarding this repo", which is the opposite of the truth on a husky repo.
    `  pre-push  ${
      hooksArmed(facts.hooks)
        ? "active"
        : facts.hooks.configuredPath !== null
          ? `NOT active (\`${facts.hooks.configuredPath}\` owns core.hooksPath)`
          : "NOT active"
    }`,
    "",
    `  ${report.ready ? "ready" : "NOT ready"}`,
  ];
  for (const w of report.warnings) lines.push(`  warn   ${w}`);
  for (const p of report.problems) lines.push(`  blocked  ${p}`);
  return lines.join("\n");
}
