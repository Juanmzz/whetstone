/**
 * Reading what this repo IS: git, the definition layer, the judge on PATH, the
 * harness plugin, the signals nobody has processed. Adapter only.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, join, relative } from "node:path";
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
import { SIGNALS_PATH } from "./signals.js";
import { signalsSince } from "../core/retro/cluster.js";
import { mentionsGate, sourcedPaths } from "../core/status/prepush.js";
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
 * The hook that reaches `wst gate`, repo-relative, or null when none does.
 *
 * Searches the configured `pre-push`, its sibling one level up (husky's layout)
 * and the default `.git/hooks/pre-push`, then what each of those sources.
 *
 * READ as text, never executed. Running someone's pre-push hook to answer a
 * status question is not a trade `status` gets to make.
 */
async function gateInPrePush(repoRoot: string, configuredPath: string | null): Promise<string | null> {
  const hooksDir = configuredPath === null ? ".git/hooks" : relativeToRepo(repoRoot, configuredPath);
  if (hooksDir === null) return null;

  const parent = hooksDir.includes("/") ? hooksDir.slice(0, hooksDir.lastIndexOf("/")) : null;
  const queue = [`${hooksDir}/pre-push`, ...(parent === null ? [] : [`${parent}/pre-push`]), ".git/hooks/pre-push"];

  const seen = new Set<string>();
  // Three levels covers husky's shim, its `h`, and the hook `h` runs.
  for (let hop = 0; hop < 3 && queue.length > 0; hop++) {
    const wave = queue.splice(0, queue.length);
    for (const path of wave) {
      if (seen.has(path)) continue;
      seen.add(path);
      const text = await readIfPresent(join(repoRoot, path));
      if (text === null) continue;
      if (mentionsGate(text)) return path;
      queue.push(...sourcedPaths(text, path));
    }
  }
  return null;
}

/** `core.hooksPath` as a repo-relative path, or null when it points outside. */
function relativeToRepo(repoRoot: string, configured: string): string | null {
  const abs = isAbsolute(configured) ? configured : join(repoRoot, configured);
  const rel = relative(repoRoot, abs);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : rel;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Repo-relative paths with uncommitted changes, tracked or not.
 *
 * `--porcelain=v1 -z`: NUL-separated, so a path with a space or a quote in it
 * survives, which `git status --porcelain` on its own does not.
 */
async function uncommittedIn(cwd: string): Promise<readonly string[]> {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
      { cwd, env: gitEnv(), maxBuffer: 16 * 1024 * 1024 },
    );
    const out: string[] = [];
    // Each record is `XY <path>`; a rename adds a second NUL-terminated path,
    // which is the old name and not a change of its own.
    const records = stdout.split("\0");
    for (let i = 0; i < records.length; i++) {
      const record = records[i] ?? "";
      if (record.length < 4) continue;
      out.push(record.slice(3));
      if (record.startsWith("R") || record.startsWith("C")) i++;
    }
    return out;
  } catch {
    return [];
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

  const configured = await hooksPath(repoRoot ?? cwd);
  const hookRoot = pluginHookRoot(cwd);
  const root = definitionRoot(repoRoot ?? cwd);
  const definitionPresent = await exists(root);

  return buildStatusReport({
    repoRoot,
    branch,
    definitionPresent,
    judge: judgeInfo,
    hooks: {
      configuredPath: configured,
      whetstoneHooksPresent: await exists(join(repoRoot ?? cwd, WHETSTONE_HOOKS_PATH)),
      gateInPrePush: await gateInPrePush(repoRoot ?? cwd, configured),
    },
    plugin: {
      install: await describePlugin(),
      hookRoot,
      hookRootIsRepo: await isRepo(hookRoot),
      hookRootHasDefinition: await exists(definitionRoot(hookRoot)),
      definitionTracked: await definitionTracked(repoRoot ?? cwd),
    },
    nodeVersion: process.version,
    uncommitted: await uncommittedIn(repoRoot ?? cwd),
    agentFiles: await agentFilesIn(repoRoot ?? cwd),
    missingTools: await missingTools(repoRoot ?? cwd),
    // Omitted, not "unknown", where there is no log: `0 fresh` is a claim about a
    // backlog, and `init` no longer seeds a signal log, so a repo that has one is
    // a repo that opted in. Reporting zero over nothing described a subsystem the
    // reader does not have.
    ...(definitionPresent && (await exists(join(root, SIGNALS_PATH)))
      ? { freshSignals: await freshSignals(root) }
      : {}),
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
