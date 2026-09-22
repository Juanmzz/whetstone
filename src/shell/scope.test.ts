/**
 * Integration, not unit: the adapter's whole job is the argument list it hands git
 * and what it makes of the answer, so the test drives a real repository and shims
 * ONE git subcommand (triage-rules.md, and the note at the top of `test/fake-bin.ts`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { rangeFiles, taskFilesFrom } from "./scope.js";
import { tempDir } from "../../test/tmp.js";

const run = promisify(execFile);
const originalPath = process.env["PATH"];
afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
});

async function repoWithUntrackedFile(): Promise<string> {
  const dir = await tempDir("wst-scope-");
  await run("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await run("git", ["config", "user.name", "T"], { cwd: dir });
  await writeFile(join(dir, "kept.txt"), "one\n");
  await run("git", ["add", "."], { cwd: dir });
  await run("git", ["commit", "-qm", "chore: first"], { cwd: dir });
  await writeFile(join(dir, "new.txt"), "never staged\n");
  return dir;
}

/** A `git` on PATH that fails `failing` and passes everything else through. */
async function shimGit(failing: string): Promise<void> {
  const dir = await tempDir("wst-git-shim-");
  const bin = join(dir, "git");
  await writeFile(
    bin,
    `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "${failing}" ]; then\n    echo "fatal: ${failing} is broken" >&2\n    exit 128\n  fi\ndone\nexec ${JSON.stringify(await realGit())} "$@"\n`,
  );
  await chmod(bin, 0o755);
  process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
}

async function realGit(): Promise<string> {
  const { stdout } = await run("sh", ["-c", "command -v git"]);
  return stdout.trim();
}

/**
 * Reproduced on 2026-09-21: with an untracked file present and a PATH shim making
 * `git ls-files` exit 128, `wst ready` answered `No changes to verify`, exit 0.
 *
 * `git()` here catches every failure and returns null, and `lines(null)` is `[]`,
 * so a read that never happened is indistinguishable from a repository with
 * nothing in it. That is hard rule 3: a broken gate reported as a verdict, and the
 * most reassuring verdict there is.
 */
describe("taskFilesFrom", () => {
  it("reports an untracked file when git answers", async () => {
    const dir = await repoWithUntrackedFile();
    const files = await taskFilesFrom("HEAD", dir);
    expect(files.untracked).toEqual(["new.txt"]);
  });

  it("THROWS when a read fails, rather than calling the repository empty", async () => {
    const dir = await repoWithUntrackedFile();
    await shimGit("ls-files");
    await expect(taskFilesFrom("HEAD", dir)).rejects.toThrow(/could not read/i);
  });

  it("names the git command that failed, so the message is actionable", async () => {
    const dir = await repoWithUntrackedFile();
    await shimGit("ls-files");
    await expect(taskFilesFrom("HEAD", dir)).rejects.toThrow(/untracked/i);
  });

  it("throws when the committed diff cannot be read either", async () => {
    const dir = await repoWithUntrackedFile();
    await shimGit("--name-status");
    await expect(taskFilesFrom("HEAD", dir)).rejects.toThrow(/could not read/i);
  });
});

describe("rangeFiles", () => {
  it("throws rather than reporting an empty range it never read", async () => {
    const dir = await repoWithUntrackedFile();
    await shimGit("--name-status");
    await expect(rangeFiles("HEAD~0..HEAD", dir)).rejects.toThrow(/could not read/i);
  });
});
