/**
 * Reading a repo as facts: its files, its manifest, its git history. Adapter only.
 *
 * It decides nothing: how deep to walk is `core/init/walk.ts`, and what the facts
 * MEAN is `detect.ts`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { skipDir, walkDepth, MAX_FILES } from "../core/init/walk.js";
import type { PackageJson, RepoFacts } from "../core/init/detect.js";
import { gitEnv } from "./git.js";

const run = promisify(execFile);

/**
 * The walk. How deep it goes is `core/init/walk.ts`'s decision, not this file's —
 * the budget restarts at every package manifest, so a monorepo's packages are each
 * read as deeply as a flat repo is.
 *
 * The directory is READ before its depth is judged, because the manifest that
 * restarts the budget is one of the entries. That costs one `readdir` at each
 * boundary and buys the walker its only view of where a package begins.
 */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const here = walkDepth(
      depth,
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    if (here === null) return;

    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (skipDir(entry.name)) continue;
        await walk(join(dir, entry.name), childRel, here + 1);
      } else {
        found.push(childRel);
      }
    }
  }

  await walk(root, "", 0);
  return found;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    // A malformed package.json is indistinguishable from an absent one for our
    // purposes: neither can be trusted to name a command that exists.
    return JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as PackageJson;
  } catch {
    return null;
  }
}

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd, env: gitEnv(), maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function gatherFacts(root: string): Promise<RepoFacts> {
  const [files, packageJson, log, shortlog] = await Promise.all([
    listFiles(root),
    readPackageJson(root),
    git(["log", "-n", "40", "--pretty=format:%s"], root),
    git(["shortlog", "-sne", "HEAD"], root),
  ]);

  const contributors =
    shortlog === null ? null : shortlog.split("\n").filter((l) => l.trim().length > 0).length;

  return {
    repoName: root.split("/").filter(Boolean).pop() ?? "project",
    files,
    packageJson,
    commitSubjects: log === null ? [] : log.split("\n").filter((s) => s.trim().length > 0),
    contributors: contributors === 0 ? null : contributors,
  };
}
