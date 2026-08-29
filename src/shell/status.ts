/**
 * Reading what this repo IS: git, the definition layer, the judge on PATH, the
 * harness plugin, the signals nobody has processed. Adapter only.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { createGitAdapter, gitEnv } from "./git.js";
import { exists } from "./fs.js";
import { readFile } from "node:fs/promises";
import { binariesFor } from "../core/checks/tools.js";
import { definitionRoot, loadRegistry } from "./sdd.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { resolveJudge } from "./judge.js";
import { describePlugin, pluginHookRoot } from "./plugin.js";
import { readCursorResult } from "./retro.js";
import { resolveMemory } from "./memory.js";
import { signalsSince } from "../core/retro/cluster.js";
import {
  buildStatusReport,
  WHETSTONE_HOOKS_PATH,
  type AgentFiles,
  type FreshSignals,
  type StatusReport,
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

/**
 * Signals recorded since the last retro's cursor, counted with `signalsSince` —
 * the same function `wst retro` uses, so the two cannot report different backlogs.
 * Every way of not knowing lands as `unknown` with its reason, never as a number.
 */
async function freshSignals(definitionRoot: string): Promise<FreshSignals> {
  const cursor = await readCursorResult(definitionRoot);
  if (cursor.kind === "unreadable") return { kind: "unknown", reason: cursor.reason };

  const since = cursor.kind === "cursor" ? cursor.id : null;
  try {
    const all = await (await resolveMemory(definitionRoot)).all();
    return { kind: "counted", count: signalsSince(all, since).length, since };
  } catch (cause) {
    return { kind: "unknown", reason: (cause as Error).message };
  }
}

/**
 * The facts, gathered once. Exported because `wst` with no arguments opens a
 * screen built from the same report: two ways to compute "what this repo has"
 * is two answers that drift.
 */
export async function gatherStatus(cwd: string = process.cwd()): Promise<StatusReport> {
  const git = createGitAdapter(cwd);
  const repoRoot = await git.repoRoot();
  const judge = await resolveJudge(definitionRoot(repoRoot ?? cwd));
  const [branch, judgeInfo] = await Promise.all([git.currentBranch(), judge.describe()]);

  const hookRoot = pluginHookRoot(cwd);
  const root = definitionRoot(repoRoot ?? cwd);
  const definitionPresent = await exists(root);

  return buildStatusReport({
    repoRoot,
    branch,
    definitionPresent,
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
    agentFiles: await agentFilesIn(repoRoot ?? cwd),
    missingTools: await missingTools(repoRoot ?? cwd),
    // Omitted, not "unknown", without a `.wst/`: there is no retro to be behind.
    ...(definitionPresent ? { freshSignals: await freshSignals(root) } : {}),
  });
}

/** The front doors, as they are on disk. `AGENTS.md` is the source; the rest point at it. */
async function agentFilesIn(root: string): Promise<AgentFiles> {
  const pointers = await Promise.all(
    ["CLAUDE.md", "GEMINI.md"].map(async (name) =>
      (await exists(join(root, name))) ? name : null,
    ),
  );
  return {
    agentsMd: await exists(join(root, "AGENTS.md")),
    pointers: pointers.filter((name): name is string => name !== null),
  };
}
