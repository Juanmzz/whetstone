/**
 * The guard `sig-ea119c62` earned: an hour of work lost to `git checkout <path>`.
 *
 * Exercised as the harness runs it — spawned, JSON on stdin, JSON on stdout — because
 * the failure mode being prevented is a real command against a real repository.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { gitEnv } from "../src/shell/git.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);
const HOOK = join(import.meta.dirname, "..", "plugin", "hooks", "uncommitted-work-guard.mjs");

interface Decision {
  readonly permissionDecision?: string;
  readonly permissionDecisionReason?: string;
}

async function ask(command: string, repo: string): Promise<Decision | null> {
  const child = exec(HOOK, [], { env: { ...gitEnv(), CLAUDE_PROJECT_DIR: repo } });
  child.child.stdin?.end(JSON.stringify({ tool_input: { command } }));
  const { stdout } = await child;
  return stdout.trim() === "" ? null : JSON.parse(stdout).hookSpecificOutput;
}

async function repoWith(dirty: boolean): Promise<string> {
  const dir = await tempDir("wst-guard-");
  const env = { ...gitEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid" };
  const git = (args: string[]): Promise<unknown> => exec("git", args, { cwd: dir, env });
  await git(["init", "-q"]);
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "a.ts"), "export const a = 1;\n", "utf-8");
  await git(["add", "-A"]);
  await git(["commit", "-qm", "first"]);
  if (dirty) await writeFile(join(dir, "src", "a.ts"), "export const a = 2;\n", "utf-8");
  return dir;
}

describe("the uncommitted-work guard", () => {
  let dirty: string;
  let clean: string;

  beforeAll(async () => {
    dirty = await repoWith(true);
    clean = await repoWith(false);
  });

  it("asks before a checkout that would discard a modified file", async () => {
    const decision = await ask("git checkout src/a.ts", dirty);

    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.permissionDecisionReason).toContain("src/a.ts");
  });

  it("names the path in full, since a trimmed status line eats its first letter", async () => {
    const decision = await ask("git reset --hard", dirty);

    expect(decision?.permissionDecisionReason).toMatch(/\bsrc\/a\.ts\b/);
  });

  it("takes a snapshot the answer cannot destroy", async () => {
    await ask("git reset --hard", dirty);

    const { stdout } = await exec("git", ["show", "refs/wst/autosave:src/a.ts"], {
      cwd: dirty,
      env: gitEnv(),
    });
    expect(stdout).toContain("a = 2");
  });

  it("says nothing at all when the tree is clean", async () => {
    expect(await ask("git checkout src/a.ts", clean)).toBeNull();
  });

  it("says nothing about a command that discards nothing", async () => {
    expect(await ask("git status", dirty)).toBeNull();
    expect(await ask("git commit -m x", dirty)).toBeNull();
  });

  it("leaves a branch switch alone, which git already refuses when it would lose work", async () => {
    expect(await ask("git checkout main", dirty)).toBeNull();
    expect(await ask("git checkout -b feature/x", dirty)).toBeNull();
  });
});
