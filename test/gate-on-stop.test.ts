/**
 * The Stop hook, spawned as the harness runs it, against a fake `wst` on PATH.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBin, restorePath } from "./fake-bin.js";
import { isolateFromInheritedGit } from "./git-env.js";
import { tempDir } from "./tmp.js";

isolateFromInheritedGit();

const exec = promisify(execFile);
const HOOK = join(import.meta.dirname, "..", "plugin", "hooks", "gate-on-stop.mjs");

interface HookOutput {
  readonly decision?: string;
  readonly hookSpecificOutput?: { readonly hookEventName?: string; readonly additionalContext?: string };
}

async function stop(root: string, input = "{}"): Promise<HookOutput | null> {
  const child = exec(HOOK, [], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  child.child.stdin?.end(input);
  const { stdout } = await child;
  return stdout.trim() === "" ? null : (JSON.parse(stdout) as HookOutput);
}

async function project(withDefinitions: boolean): Promise<string> {
  const dir = await tempDir("wst-stop-");
  if (withDefinitions) await mkdir(join(dir, ".wst"));
  return dir;
}

async function git(dir: string, ...args: string[]): Promise<void> {
  await exec("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
}

async function repoWithCommittedWork(): Promise<string> {
  const dir = await project(true);
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "commit", "-q", "--allow-empty", "-m", "base");
  await git(dir, "checkout", "-q", "-b", "task");
  await writeFile(join(dir, "feature.ts"), "export const x = 1;\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "feat: x");
  return dir;
}

describe("the gate-on-stop hook", () => {
  afterEach(restorePath);

  it("tells the agent the change is not fully verified when ready answered INCOMPLETE", async () => {
    await installFakeBin("wst", { exit: 2, stderr: "whetstone crashed before it could finish.\n" });

    const out = await stop(await project(true));

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput?.hookEventName).toBe("Stop");
    const context = out?.hookSpecificOutput?.additionalContext;
    expect(context).toContain("answered INCOMPLETE: this change is not fully verified");
    expect(context).not.toContain("could not run");
    expect(context).toContain("whetstone crashed");
  });

  it("stays silent on exit 2 in a project that never set Whetstone up", async () => {
    await installFakeBin("wst", { exit: 2 });

    expect(await stop(await project(false))).toBeNull();
  });

  it("blocks on a failed check", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "FAIL test\n" });

    const out = await stop(await project(true));

    expect(out?.decision).toBe("block");
  });

  it("stays silent when the gate passed", async () => {
    await installFakeBin("wst", { exit: 0 });

    expect(await stop(await project(true))).toBeNull();
  });

  it("asks `ready`, not `gate`, so the verdict does not depend on the working tree", async () => {
    const wst = await installFakeBin("wst", { exit: 0 });

    await stop(await project(true));

    expect((await wst.invocations()).map((i) => i.argv)).toEqual([["ready"]]);
  });

  it("blocks with ready's own text when the agent committed before stopping", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "NOT_READY\n  FAIL test\n" });

    const out = await stop(await repoWithCommittedWork());

    expect(out?.decision).toBe("block");
    expect((out as { reason?: string }).reason).toContain("FAIL test");
  });

  it("blocks when the only change is an untracked file", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "NOT_READY\n  FAIL lint\n" });
    const dir = await repoWithCommittedWork();
    await git(dir, "checkout", "-q", "main");
    await writeFile(join(dir, "new.ts"), "export {};\n");

    expect((await stop(dir))?.decision).toBe("block");
  });

  it("stays silent on NO_CHANGES", async () => {
    await installFakeBin("wst", { exit: 0, stdout: "NO_CHANGES\n" });

    expect(await stop(await project(true))).toBeNull();
  });

  it("does not run anything in a project without .wst/", async () => {
    const wst = await installFakeBin("wst", { exit: 1, stdout: "FAIL\n" });

    expect(await stop(await project(false))).toBeNull();
    expect(await wst.invocations()).toEqual([]);
  });

  it("tells the agent ready did not finish when it was killed before it answered", async () => {
    const bin = await tempDir("wst-killed-");
    await writeFile(join(bin, "wst"), "#!/bin/sh\nkill -9 $$\n");
    await chmod(join(bin, "wst"), 0o755);
    process.env["PATH"] = `${bin}:${process.env["PATH"] ?? ""}`;

    const out = await stop(await project(true));

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput?.additionalContext).toContain("did not finish");
  });

  it("does not block again after a fix attempt, and says the work is still NOT_READY", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "NOT_READY\n  FAIL test\n" });

    const out = await stop(await project(true), '{"stop_hook_active":true}');

    expect(out?.decision).toBeUndefined();
    const context = out?.hookSpecificOutput?.additionalContext;
    expect(context).toContain("still NOT_READY");
    expect(context).toContain("Do not report the work as ready");
    expect(context).toContain("FAIL test");
  });

  it("blocks on the first stop when the flag is false", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "FAIL test\n" });

    expect((await stop(await project(true), '{"stop_hook_active":false}'))?.decision).toBe("block");
  });

  it("blocks when stdin is not JSON", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "FAIL test\n" });

    expect((await stop(await project(true), "not json"))?.decision).toBe("block");
  });

  it("still tells INCOMPLETE as a notice when the flag is true", async () => {
    await installFakeBin("wst", { exit: 2, stderr: "INCOMPLETE\n" });

    const out = await stop(await project(true), '{"stop_hook_active":true}');

    expect(out?.hookSpecificOutput?.additionalContext).toContain("answered INCOMPLETE");
  });
});
