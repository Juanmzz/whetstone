/**
 * Git adapter. THIN by policy: it runs commands and returns raw text. All parsing
 * lives in `src/core/diff/` so it can be tested without a repository.
 */

import { execFile } from "node:child_process";
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
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      env: cleanEnv(),
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
      return (await git(["diff", "--name-status", range], cwd)) ?? "";
    },
    async hashFile(path: string) {
      const hash = await git(["hash-object", path], cwd);
      if (hash === null) throw new Error(`could not hash ${path}`);
      return hash;
    },
  };
}
