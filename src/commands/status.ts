/**
 * Composition root for `wst status`: build the adapters, gather facts, hand them to
 * the pure core, print. No decisions are made here.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { createGitAdapter } from "../shell/git.js";
import { createClaudeJudge } from "../shell/claude.js";
import { buildStatusReport, renderStatusReport } from "../core/status/report.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runStatus(cwd: string = process.cwd()): Promise<number> {
  const git = createGitAdapter(cwd);
  const judge = createClaudeJudge();

  const repoRoot = await git.repoRoot();
  const [branch, judgeInfo] = await Promise.all([git.currentBranch(), judge.describe()]);

  const report = buildStatusReport({
    repoRoot,
    branch,
    sddPresent: await exists(join(repoRoot ?? cwd, ".sdd")),
    judge: judgeInfo,
    nodeVersion: process.version,
  });

  console.log(renderStatusReport(report));
  return report.ready ? 0 : 1;
}
