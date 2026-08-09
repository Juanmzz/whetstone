/**
 * Composition root for `wst status`: build the adapters, gather facts, hand them to
 * the pure core, print. No decisions are made here.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import { createClaudeJudge } from "../shell/claude.js";
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

export async function runStatus(
  cwd: string = process.cwd(),
  options: { readonly quiet?: boolean } = {},
): Promise<number> {
  const git = createGitAdapter(cwd);
  const judge = createClaudeJudge();

  const repoRoot = await git.repoRoot();
  const [branch, judgeInfo] = await Promise.all([git.currentBranch(), judge.describe()]);

  const report = buildStatusReport({
    repoRoot,
    branch,
    sddPresent: await exists(join(repoRoot ?? cwd, ".sdd")),
    judge: judgeInfo,
    hooks: {
      configuredPath: await hooksPath(repoRoot ?? cwd),
      whetstoneHooksPresent: await exists(join(repoRoot ?? cwd, WHETSTONE_HOOKS_PATH)),
    },
    nodeVersion: process.version,
  });

  console.log(renderStatusReport(report, options));
  return report.ready ? 0 : 1;
}
