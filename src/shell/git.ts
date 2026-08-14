/**
 * Git adapter. THIN by policy: it runs commands and returns raw text. All parsing
 * lives in `src/core/diff/` so it can be tested without a repository.
 */

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import type { GitPort } from "../core/ports.js";

const run = promisify(execFile);

/**
 * The environment every `git` here runs in: this process's, minus the whole `GIT_*`
 * block.
 *
 * `sig-82dec46b`. Git exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and
 * friends to everything a hook spawns, and the pre-push hook spawns `wst gate`. The
 * adapter took a `cwd` and inherited the rest, so a command pointed at directory A
 * operated on repository B. Observed twice: the main repository's INDEX was written
 * with another worktree's file state, staging a revert of ~3,500 lines, and
 * `core.bare` flipped to `true`. A `git commit` at the wrong moment would have made
 * either permanent.
 *
 * The cwd is this adapter's entire contract. A variable that silently overrides it
 * demotes the parameter to a suggestion.
 *
 * The WHOLE block goes, not a chosen few — the same argument `test/git-env.ts` makes:
 * git has a dozen of these and adds more, so an allowlist is a guard that only
 * catches the variables someone already thought of. Nothing is lost by clearing
 * them: every command below READS (`rev-parse`, `diff`, `hash-object`), so no
 * identity is needed, and git falls back to its compiled defaults for the rest.
 *
 * Read PER CALL rather than captured at module load. A snapshot would freeze
 * whatever `process.env` held the first time this file was imported, so a later
 * change to `PATH` — which the test helpers make, and which a caller could make —
 * would silently not reach `git`. Cloning fifty entries is not a cost worth a
 * staleness bug.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function createGitAdapter(cwd: string = process.cwd()): GitPort {
  return {
    async repoRoot() {
      return git(["rev-parse", "--show-toplevel"], cwd);
    },
    async currentBranch() {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      return branch === "HEAD" ? null : branch; // detached
    },
    async diffNameStatus(range: string) {
      // THROWS on a range git rejected, rather than reporting an empty diff.
      //
      // `git()` swallowing an error is right for the two calls above — "not a
      // repository" and "detached HEAD" are answers. Here it produced the same
      // bytes for "this range has no changes" and "this range does not exist", and
      // the second is not an answer. `wst triage --range typo` reported
      // `off — no files changed` and exit 0; every caller of this port already has
      // a `catch` that says "could not read the diff for <range>", which is the
      // sentence that sends someone to look at what they typed.
      const out = await git(["diff", "--name-status", range], cwd);
      if (out === null) {
        throw new Error(`git could not read the range \`${range}\` — check that it exists`);
      }
      return out;
    },
    async hashFile(path: string) {
      const hash = await git(["hash-object", path], cwd);
      if (hash === null) throw new Error(`could not hash ${path}`);
      return hash;
    },
  };
}

/**
 * Refuse to touch a directory that is not the worktree it claims to be.
 *
 * `cwd` is not a guarantee. `GIT_DIR` overrides it, and `gitEnv()` above removes the
 * inherited block for every call that goes through this file — but `wst prepare`
 * runs `git reset --hard`, `git switch -C` and `ln -sfn` on a leased worktree, and
 * a destructive command should not depend on nobody having reintroduced a variable,
 * on treehouse returning the path it promised, or on a caller passing the right
 * string. It should ask.
 *
 * So it asks: resolve the repository root from inside the directory, and compare it
 * to the directory. `realpath` on both, because a leased worktree reached through a
 * symlink is the ordinary case and is not a mismatch.
 *
 * `sig-82dec46b` is the incident. The environment leak wrote the MAIN repository's
 * index twice, from commands that believed they were somewhere else. Removing the
 * leak fixes the cause that was found; this survives the next one.
 */
export async function assertWorktreeAt(path: string): Promise<void> {
  const root = await git(["rev-parse", "--show-toplevel"], path);
  if (root === null) {
    throw new Error(`refusing to operate on ${path}: it is not a git worktree`);
  }
  const [here, there] = [realpathSync(path), realpathSync(root)];
  if (here !== there) {
    throw new Error(
      `refusing to operate on ${path}: git resolves it to ${there}, not ${here} — ` +
        `the target is not what it claims to be`,
    );
  }
}
