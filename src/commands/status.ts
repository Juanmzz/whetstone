/**
 * Composition root for `wst status`: build the adapters, gather facts, hand them to
 * the pure core, print. No decisions are made here.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import { definitionRoot } from "../shell/sdd.js";
import { DEFINITION_DIR, LEGACY_DEFINITION_DIR } from "../core/paths.js";
import { createClaudeJudge } from "../shell/claude.js";
import { describePlugin } from "../shell/plugin.js";
import {
  buildStatusReport,
  renderStatusReport,
  WHETSTONE_HOOKS_PATH,
} from "../core/status/report.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `core.hooksPath`, or null when unset.
 *
 * Reported VERBATIM rather than compared to `.githooks` here. The comparison is a
 * decision and belongs in `core/status/`; collapsing it to a boolean at this layer
 * is what let status tell a husky repo to disarm itself.
 */
async function hooksPath(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("git", ["config", "--get", "core.hooksPath"], { cwd });
    const value = stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Whether `.wst/` is TRACKED, not merely present.
 *
 * Untracked files do not propagate into git worktrees, so an uncommitted `.wst/` is
 * present here and absent in every worktree cut from here — which silently disables
 * the plugin's hooks in exactly the places `wst prepare` sends work (sig-0044).
 */
async function definitionTracked(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "--", DEFINITION_DIR], { cwd });
    return stdout.trim() !== "";
  } catch {
    return false;
  }
}

async function isRepo(cwd: string): Promise<boolean> {
  return (await createGitAdapter(cwd).repoRoot()) !== null;
}

export async function runStatus(
  cwd: string = process.cwd(),
  options: { readonly quiet?: boolean } = {},
): Promise<number> {
  const git = createGitAdapter(cwd);
  const judge = createClaudeJudge();

  const repoRoot = await git.repoRoot();
  const [branch, judgeInfo] = await Promise.all([git.currentBranch(), judge.describe()]);

  // Where the plugin's Stop hook would run the gate. It reads `CLAUDE_PROJECT_DIR`,
  // which is NOT always the repo — in the field it was the umbrella folder holding
  // several repos, so both hooks were inert all session with nothing to show for it.
  const hookRoot = process.env["CLAUDE_PROJECT_DIR"] ?? cwd;

  const report = buildStatusReport({
    repoRoot,
    branch,
    definitionPresent: await exists(definitionRoot(repoRoot ?? cwd)),
    legacyPresent: await exists(join(repoRoot ?? cwd, LEGACY_DEFINITION_DIR)),
    judge: judgeInfo,
    hooks: {
      configuredPath: await hooksPath(repoRoot ?? cwd),
      whetstoneHooksPresent: await exists(join(repoRoot ?? cwd, WHETSTONE_HOOKS_PATH)),
    },
    plugin: {
      install: await describePlugin(),
      hookRoot,
      hookRootIsRepo: await isRepo(hookRoot),
      hookRootHasDefinition: await exists(definitionRoot(hookRoot)),
      definitionTracked: await definitionTracked(repoRoot ?? cwd),
    },
    nodeVersion: process.version,
  });

  console.log(renderStatusReport(report, options));
  return report.ready ? 0 : 1;
}
