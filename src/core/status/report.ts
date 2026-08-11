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
  readonly plugin: PluginFacts;
}

/**
 * What the harness says about the Whetstone plugin. Four states, not a boolean —
 * "never installed" and "installed and switched off" have different fixes, and
 * "we could not ask" is not evidence of either.
 */
export type PluginInstall = "enabled" | "disabled" | "absent" | "unknown";

/**
 * Whether the plugin's hooks would DO anything from here.
 *
 * `plugin/hooks/gate-on-stop.mjs` exits silently whenever it cannot run — no `.sdd/`,
 * no `wst`, not a repo. That is the right behaviour for a hook and it leaves the user
 * with no way to discover it. These are the facts that answer it.
 */
export interface PluginFacts {
  readonly install: PluginInstall;
  /**
   * The directory the Stop hook would run the gate in: `CLAUDE_PROJECT_DIR` when the
   * harness sets it, else the cwd. NOT necessarily the repo — in the field it was an
   * umbrella folder holding several repos, and every hook was inert because of it.
   */
  readonly hookRoot: string;
  readonly hookRootIsRepo: boolean;
  readonly hookRootHasSdd: boolean;
  /** Whether `.sdd/` is tracked. Untracked files do not propagate into worktrees. */
  readonly sddTracked: boolean;
}

/** Why the hooks would do nothing from here, or `null` when they would. */
export function pluginInertReason(plugin: PluginFacts): string | null {
  if (!plugin.hookRootIsRepo) {
    return `\`${plugin.hookRoot}\` is not a git repository, so the gate cannot run there`;
  }
  if (!plugin.hookRootHasSdd) {
    return `\`${plugin.hookRoot}\` has no \`.sdd/\`, so there is nothing to gate against`;
  }
  return null;
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

  // The plugin, and only when there IS one. A repo that never adopted it is not
  // broken, and a warning about a hook nobody installed is the noise that gets muted.
  if (facts.plugin.install === "disabled") {
    warnings.push(
      `the Whetstone plugin is installed but DISABLED, so neither the strict-path guard ` +
        `nor the gate-on-stop hook will fire — enable it, or uninstall it so status stops ` +
        `reporting it`,
    );
  }
  if (facts.plugin.install === "enabled") {
    const inert = pluginInertReason(facts.plugin);
    if (inert !== null) {
      // The hook exits silently here BY DESIGN, so this line is the only place the
      // fact is available. Without it, inert and working produce identical output.
      warnings.push(
        `the plugin is loaded but INERT from here: ${inert}. Its hooks fail silently on ` +
          `purpose, so nothing else will tell you`,
      );
    } else if (!facts.plugin.sddTracked) {
      warnings.push(
        `\`.sdd/\` is not tracked by git. Untracked files do not propagate into worktrees, ` +
          `so the plugin is inert in every worktree cut from this repo — including the ones ` +
          `\`wst run\` leases. Commit \`.sdd/\` to fix it`,
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

/**
 * The plugin row. Says which of the four install states holds, and — when the plugin
 * IS loaded — whether it would do anything from where you are standing.
 *
 * "loaded" alone would repeat the mistake the pre-push row already fixed once: a
 * loaded-and-inert plugin and a loaded-and-working one produced identical output, and
 * the whole point of the row is that they must not.
 */
function pluginRow(plugin: PluginFacts): string {
  switch (plugin.install) {
    case "absent":
      return "not installed";
    case "disabled":
      return "installed but DISABLED — its hooks will not fire";
    case "unknown":
      return "unknown (could not ask the harness)";
    case "enabled": {
      const inert = pluginInertReason(plugin);
      return inert === null ? "loaded — hooks active here" : `loaded, but INERT here: ${inert}`;
    }
  }
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
    `  plugin    ${pluginRow(facts.plugin)}`,
    "",
    `  ${report.ready ? "ready" : "NOT ready"}`,
  ];
  for (const w of report.warnings) lines.push(`  warn   ${w}`);
  for (const p of report.problems) lines.push(`  blocked  ${p}`);
  return lines.join("\n");
}
