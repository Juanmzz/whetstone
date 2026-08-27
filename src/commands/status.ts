/**
 * Composition root for `wst status`: build the adapters, gather facts, hand them to
 * the pure core, print. No decisions are made here.
 */

import { statusEnvelope } from "../core/status/machine.js";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { createGitAdapter, gitEnv } from "../shell/git.js";
import { exists } from "../shell/fs.js";
import { readFile } from "node:fs/promises";
import { binariesFor } from "../core/checks/tools.js";
import { definitionRoot, loadRegistry } from "../shell/sdd.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { resolveJudge } from "../shell/judge.js";
import { describePlugin, pluginHookRoot } from "../shell/plugin.js";
import {
  buildStatusReport,
  renderStatusReport,
  WHETSTONE_HOOKS_PATH,
} from "../core/status/report.js";

/**
 * `core.hooksPath`, or null when unset.
 *
 * Reported VERBATIM rather than compared to `.githooks` here. The comparison is a
 * decision and belongs in `core/status/`; collapsing it to a boolean at this layer
 * is what let status tell a husky repo to disarm itself.
 */
async function hooksPath(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("git", ["config", "--get", "core.hooksPath"], { cwd, env: gitEnv() });
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
 * the plugin's hooks in exactly the places work happens (sig-0044).
 */
async function definitionTracked(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "--", DEFINITION_DIR], { cwd, env: gitEnv() });
    return stdout.trim() !== "";
  } catch {
    return false;
  }
}

async function isRepo(cwd: string): Promise<boolean> {
  return (await createGitAdapter(cwd).repoRoot()) !== null;
}


/**
 * Binaries a registered check would need and that are not here.
 *
 * Resolved against `node_modules/.bin` first, because a devDependency is on
 * PATH only while npm is running the script.
 */
async function missingTools(
  root: string,
): Promise<readonly { checkId: string; binary: string }[]> {
  let scripts: Record<string, string> = {};
  try {
    const pkg: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    const declared = (pkg as { scripts?: unknown }).scripts;
    if (declared !== null && typeof declared === "object") scripts = declared as Record<string, string>;
  } catch {
    // No manifest is normal; it only means no scripts to follow.
  }

  let registry;
  try {
    registry = await loadRegistry(definitionRoot(root));
  } catch {
    return [];
  }

  const gaps: { checkId: string; binary: string }[] = [];
  for (const check of registry.active) {
    if (check.kind !== "deterministic" || check.command === undefined) continue;
    for (const binary of binariesFor(check.command, scripts)) {
      if (await resolves(binary, root)) continue;
      gaps.push({ checkId: check.id, binary });
    }
  }
  return gaps;
}

async function resolves(binary: string, root: string): Promise<boolean> {
  if (await exists(join(root, "node_modules", ".bin", binary))) return true;
  try {
    await promisify(execFile)("sh", ["-c", `command -v ${binary}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function runStatus(
  cwd: string = process.cwd(),
  options: { readonly quiet?: boolean; readonly json?: boolean } = {},
): Promise<number> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  const judge = await resolveJudge(definitionRoot(repoRoot ?? cwd));
  const [branch, judgeInfo] = await Promise.all([git.currentBranch(), judge.describe()]);

  const hookRoot = pluginHookRoot(cwd);

  const report = buildStatusReport({
    repoRoot,
    branch,
    definitionPresent: await exists(definitionRoot(repoRoot ?? cwd)),
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
    missingTools: await missingTools(repoRoot ?? cwd),
  });

  // `--json` for the reader that is not a person. The init skill tells an agent to
  // run this FIRST, and until now the answer came back as English — so any wording
  // change was a silent behaviour change for every agent downstream.
  console.log(options.json === true ? JSON.stringify(statusEnvelope(report), null, 2) : renderStatusReport(report, options));
  return report.ready ? 0 : 1;
}
