/**
 * treehouse adapter — isolated git worktrees for parallel crewmates.
 *
 * Whetstone does not build worktree management; it delegates it (ADR: "adopt
 * treehouse"). This is a thin wrapper over the CLI, nothing more.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Worktree {
  readonly path: string;
  readonly holder: string;
}

export interface TreehousePort {
  lease(holder: string): Promise<Worktree>;
  release(path: string): Promise<void>;
  available(): Promise<boolean>;
}

export function createTreehouseAdapter(cwd: string = process.cwd()): TreehousePort {
  return {
    async available() {
      try {
        await run("treehouse", ["--version"], { cwd, timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },

    async lease(holder: string) {
      // --lease is the non-interactive form: it reserves the worktree durably and
      // prints only the path. Without it, `treehouse get` opens a subshell, which
      // a dispatcher cannot drive.
      const { stdout } = await run(
        "treehouse",
        ["get", "--lease", "--lease-holder", holder],
        { cwd, timeout: 120_000 },
      );
      const path = stdout.trim().split("\n").filter(Boolean).pop();
      if (path === undefined || path === "") {
        throw new Error("treehouse get --lease returned no path");
      }
      return { path, holder };
    },

    async release(path: string) {
      await run("treehouse", ["return", "--force", path], { cwd, timeout: 120_000 });
    },
  };
}
