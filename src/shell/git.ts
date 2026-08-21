/**
 * Git adapter. THIN by policy: it runs commands and returns raw text. All parsing
 * lives in `src/core/diff/` so it can be tested without a repository.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * `core.quotePath=false` on EVERY call, not just the diff.
 *
 * git's default quotes any path byte outside ASCII: `src/señal.ts` comes back as
 * the literal `"src/se\303\261al.ts"`, quotes included. Nothing downstream
 * unquotes it, so that string matched no `include` glob, no check selected the
 * file, and the gate reported that nothing applied to a change plainly inside
 * `src/`. A real blocking failure exited 0 through this hole.
 *
 * Set here rather than at the one call that showed the bug: `ls-files` and
 * `hash-object` quote by the same rule, and a second call learning it separately
 * is how this comes back.
 */
const QUOTE_PATH_OFF = ["-c", "core.quotePath=false"];

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", [...QUOTE_PATH_OFF, ...args], {
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
      const out = await git(["diff", "--name-status", range], cwd);
      if (out === null) {
        throw new Error(`git could not read the range \`${range}\` — check that it exists`);
      }
      return out;
    },
    /**
     * Read and hash in process, rather than spawning `git hash-object` per file.
     *
     * The receipt never compares against git's object store — it only needs a
     * fingerprint of the bytes, and any hash serves. Measured over 50 files:
     * 391ms of spawns against 30ms in process.
     *
     * Changing the function makes every receipt on disk stop matching, which is
     * self-healing: one full gate run re-earns them.
     */
    async hashFile(path: string) {
      try {
        return createHash("sha256").update(await readFile(join(cwd, path))).digest("hex");
      } catch (cause) {
        throw new Error(`could not hash ${path}: ${(cause as Error).message}`);
      }
    },
  };
}

