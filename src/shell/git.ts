/**
 * Git adapter. THIN by policy: it runs commands and returns raw text. All parsing
 * lives in `src/core/diff/` so it can be tested without a repository.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitPort } from "../core/ports.js";

const run = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
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
