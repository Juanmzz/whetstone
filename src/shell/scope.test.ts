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
 * Reproduced 2026-09-21: with an untracked file present and `git ls-files` exiting
 * 128, `ready` answered `No changes to verify`, exit 0. A swallowed null is the
 * same empty list a clean tree gives.
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

/** The other half: a quoted path matched no glob, and its blocking check vanished. */
describe("paths git would otherwise quote", () => {
  it("reports a tab in an untracked path as the tab it is", async () => {
    const dir = await tempDir("wst-scope-odd-");
    await run("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "T"], { cwd: dir });
    await writeFile(join(dir, "kept.txt"), "one\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-qm", "chore: first"], { cwd: dir });
    await mkdir(join(dir, "special"), { recursive: true });
    await writeFile(join(dir, "special", "a\tb.js"), "x\n");

    const files = await taskFilesFrom("HEAD", dir);

    expect(files.untracked).toEqual(["special/a\tb.js"]);
    expect(files.untracked[0]).not.toContain('"');
  });

  it("reports a tab in a STAGED path the same way", async () => {
    const dir = await tempDir("wst-scope-staged-");
    await run("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "T"], { cwd: dir });
    await writeFile(join(dir, "kept.txt"), "one\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-qm", "chore: first"], { cwd: dir });
    await mkdir(join(dir, "special"), { recursive: true });
    await writeFile(join(dir, "special", "a\tb.js"), "x\n");
    await run("git", ["add", "-A"], { cwd: dir });

    const files = await taskFilesFrom("HEAD", dir);

    expect(files.staged).toEqual(["special/a\tb.js"]);
  });
});
