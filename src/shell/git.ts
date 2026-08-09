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
      return (await git(["diff", "--name-status", range], cwd)) ?? "";
    },
    async hashFile(path: string) {
      const hash = await git(["hash-object", path], cwd);
      if (hash === null) throw new Error(`could not hash ${path}`);
      return hash;
    },
  };
}
