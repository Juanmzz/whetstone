/**
 * Reading the local refs `wst ready` needs to find its own base. Adapter only.
 *
 * NEVER FETCHES. A verification command that reaches the network depends on
 * credentials and on a remote being up, and it hangs where it should answer. A
 * stale remote-tracking ref is a knowable state; a hung fetch is not.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitEnv } from "./git.js";
import type { ScopeFacts } from "../core/ready/scope.js";

const run = promisify(execFile);

async function git(args: readonly string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", [...args], { cwd, env: gitEnv(), maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

const lines = (out: string | null): string[] =>
  out === null ? [] : out.split("\n").map((l) => l.trim()).filter((l) => l !== "");

/** Everything `resolveBase` reads, gathered in one pass. */
export async function readScopeFacts(cwd: string): Promise<ScopeFacts> {
  const [branch, upstream, originHead, local, remote] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd),
    git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd),
    git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd),
    git(["for-each-ref", "--format=%(refname:short)", "refs/remotes"], cwd),
  ]);

  return {
    // `HEAD` is what `--abbrev-ref` prints when there is no branch.
    branch: branch === null || branch === "HEAD" ? null : branch,
    upstream,
    // Unset in most clones: `origin/HEAD` is written by `clone`, not by `fetch`.
    originHead: originHead === null || originHead === "origin/HEAD" ? null : originHead,
    localBranches: lines(local),
    remoteBranches: lines(remote).filter((r) => !r.endsWith("/HEAD")),
  };
}

/** The commit a base ref resolves to, so the report names what it actually compared. */
export async function mergeBaseOf(base: string, cwd: string): Promise<string | null> {
  return git(["merge-base", base, "HEAD"], cwd);
}

/**
 * Files this task touched, split by where they are.
 *
 * SPLIT and not totalled. An agent that forgot to `git add` reads a total and
 * believes its work was verified; the breakdown is the only place the file it
 * left behind is visible. The union is what gets checked either way.
 */
export interface TaskFiles {
  readonly committed: readonly string[];
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
}

/**
 * The repository root, so the scope of a task does not depend on which directory
 * the agent happened to be standing in.
 *
 * Only `ls-files --others` actually needs it: alone among these calls it answers
 * relative to the process cwd, in what it lists AND in the paths it prints, so run
 * from `apps/api` it reported NO CHANGES over a repo with an untracked file in
 * `packages/shared`. Every call takes the root anyway, because the next one added
 * here should not have to know which kind it is.
 */
async function topLevel(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
}

/** Just the paths, from `--name-status` output. */
const pathsOf = (out: string | null): string[] =>
  lines(out).map((l) => {
    const parts = l.split("\t");
    // A rename gives `R100 old new`; the path after the change is what triage reads.
    return parts.at(-1) ?? "";
  }).filter((p) => p !== "");

/**
 * The files a caller-supplied RANGE names. All reported as committed, because a
 * range is a statement about commits: there is no working tree in `a..b`.
 *
 * Separate from `taskFilesFrom` because that one builds `<base>..HEAD` itself, and
 * handing it a full range produced `a..b..HEAD`, which git rejects. The `--range`
 * override is the CI path, so it broke exactly where nobody was watching.
 */
export async function rangeFiles(range: string, cwd: string): Promise<TaskFiles> {
  const root = await topLevel(cwd);
  return {
    committed: pathsOf(await git(["diff", "--name-status", range], root)),
    staged: [],
    unstaged: [],
    untracked: [],
  };
}

export async function taskFilesFrom(mergeBase: string, cwd: string): Promise<TaskFiles> {
  const root = await topLevel(cwd);
  const [committed, staged, unstaged, untracked] = await Promise.all([
    git(["diff", "--name-status", `${mergeBase}..HEAD`], root),
    git(["diff", "--name-status", "--cached"], root),
    git(["diff", "--name-status"], root),
    git(["ls-files", "--others", "--exclude-standard"], root),
  ]);
  return {
    committed: pathsOf(committed),
    staged: pathsOf(staged),
    unstaged: pathsOf(unstaged),
    untracked: lines(untracked),
  };
}
