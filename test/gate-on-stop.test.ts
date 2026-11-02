/**
 * The Stop hook, spawned as the harness runs it, against a fake `wst` on PATH.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBin, restorePath, type FakeBin } from "./fake-bin.js";
import { isolateFromInheritedGit } from "./git-env.js";
import { tempDir } from "./tmp.js";

isolateFromInheritedGit();

const exec = promisify(execFile);
const HOOK = join(import.meta.dirname, "..", "plugin", "hooks", "gate-on-stop.mjs");

interface HookOutput {
  readonly decision?: string;
  readonly systemMessage?: string;
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

async function readyRuns(wst: FakeBin): Promise<number> {
  return (await wst.invocations()).filter((i) => i.argv[0] === "ready").length;
}

async function fakeWst(response: { exit: number; stdout?: string; stderr?: string }): Promise<FakeBin> {
  const wst = await installFakeBin("wst", response);
  await wst.respondWith({ stdout: "0.10.0\n", exit: 0 }, "--version");
  return wst;
}

const envelope = (result: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ result, applicable: [], declined: [], uncovered: [], results: [], ...extra });

const UNCOVERED = envelope("INCOMPLETE", { reason: "no check covers 1 changed path", uncovered: ["docs/a.md"] });

async function repo(): Promise<string> {
  const dir = await project(true);
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "commit", "-q", "--allow-empty", "-m", "base");
  return dir;
}

async function countingKiller(): Promise<string> {
  const bin = await tempDir("wst-killed-");
  await writeFile(join(bin, "wst"), '#!/bin/sh\ncase "$1" in --version) echo 0.10.0; exit 0;; esac\necho run >> "$(dirname "$0")/runs"\nkill -9 $$\n');
  await chmod(join(bin, "wst"), 0o755);
  process.env["PATH"] = `${bin}:${process.env["PATH"] ?? ""}`;
  return join(bin, "runs");
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

    expect(await readyRuns(wst)).toBe(1);
    expect((await wst.invocations()).map((i) => i.argv)).toEqual([["ready", "--json"]]);
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

  it("only warns the user after a fix attempt, and never continues the turn on exit 1", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "NOT_READY\n  FAIL test\n" });

    const out = await stop(await project(true), '{"stop_hook_active":true}');

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput).toBeUndefined();
    expect(out?.systemMessage).toContain("still NOT_READY");
    expect(out?.systemMessage).toContain("FAIL test");
  });

  it("blocks on the first stop when the flag is false", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "FAIL test\n" });

    expect((await stop(await project(true), '{"stop_hook_active":false}'))?.decision).toBe("block");
  });

  it("blocks when stdin is not JSON", async () => {
    await installFakeBin("wst", { exit: 1, stdout: "FAIL test\n" });

    expect((await stop(await project(true), "not json"))?.decision).toBe("block");
  });

  it("only warns the user on INCOMPLETE when the flag is true", async () => {
    await installFakeBin("wst", { exit: 2, stderr: "INCOMPLETE\n" });

    const out = await stop(await project(true), '{"stop_hook_active":true}');

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput).toBeUndefined();
    expect(out?.systemMessage).toContain("INCOMPLETE");
  });

  it("only warns the user when ready was killed and the flag is true", async () => {
    const bin = await tempDir("wst-killed-");
    await writeFile(join(bin, "wst"), "#!/bin/sh\nkill -9 $$\n");
    await chmod(join(bin, "wst"), 0o755);
    process.env["PATH"] = `${bin}:${process.env["PATH"] ?? ""}`;

    const out = await stop(await project(true), '{"stop_hook_active":true}');

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput).toBeUndefined();
    expect(out?.systemMessage).toContain("did not finish");
  });
});

describe("the gate-on-stop hook remembers what it already reported", () => {
  afterEach(restorePath);

  it("reports a docs-only INCOMPLETE once across eight identical stops", async () => {
    const wst = await fakeWst({ exit: 2, stdout: UNCOVERED });
    const dir = await repo();
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "a.md"), "# a\n");

    const outs = [];
    for (let i = 0; i < 8; i++) outs.push(await stop(dir));

    expect(outs.filter((o) => o?.systemMessage !== undefined)).toHaveLength(1);
    expect(outs.filter((o) => o?.hookSpecificOutput !== undefined)).toHaveLength(0);
    expect(outs.filter((o) => o?.decision !== undefined)).toHaveLength(0);
    expect(await readyRuns(wst)).toBe(1);
  });

  it("runs again when a file is edited to different content under the same status line", async () => {
    const wst = await fakeWst({ exit: 0, stdout: envelope("READY") });
    const dir = await repo();
    await writeFile(join(dir, "a.md"), "one\n");
    await stop(dir);
    await stop(dir);
    expect(await readyRuns(wst)).toBe(1);

    await writeFile(join(dir, "a.md"), "two\n");
    await stop(dir);

    expect(await readyRuns(wst)).toBe(2);
  });

  it("counts a new untracked file, a commit and a deletion each as a new state", async () => {
    const wst = await fakeWst({ exit: 0, stdout: envelope("READY") });
    const dir = await repo();
    await writeFile(join(dir, "keep.ts"), "export {};\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "feat: keep");
    await stop(dir);
    expect(await readyRuns(wst)).toBe(1);

    await writeFile(join(dir, "new.ts"), "export {};\n");
    await stop(dir);
    expect(await readyRuns(wst)).toBe(2);

    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "feat: new");
    await stop(dir);
    expect(await readyRuns(wst)).toBe(3);

    await rm(join(dir, "keep.ts"));
    await stop(dir);
    expect(await readyRuns(wst)).toBe(4);
  });

  it("treats an unborn HEAD as a state, not an error", async () => {
    const wst = await fakeWst({ exit: 0, stdout: envelope("READY") });
    const dir = await project(true);
    await git(dir, "init", "-q", "-b", "main");

    await stop(dir);
    await stop(dir);

    expect(await readyRuns(wst)).toBe(1);
  });

  it("re-verifies when wst is upgraded", async () => {
    const wst = await fakeWst({ exit: 0, stdout: envelope("READY") });
    const dir = await repo();
    await stop(dir);

    await wst.respondWith({ stdout: "0.10.1\n", exit: 0 }, "--version");
    await stop(dir);

    expect(await readyRuns(wst)).toBe(2);
  });

  it("blocks a real NOT_READY, and blocks again on a new edit", async () => {
    const wst = await fakeWst({ exit: 1, stdout: envelope("NOT_READY", { results: [{ id: "test", status: "fail", detail: ["expected 1, got 2"] }] }) });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "1\n");

    const first = await stop(dir);
    expect(first?.decision).toBe("block");
    expect((first as { reason?: string }).reason).toContain("FAIL test");
    expect((first as { reason?: string }).reason).toContain("expected 1, got 2");

    expect(await stop(dir)).toBeNull();
    await writeFile(join(dir, "a.ts"), "2\n");
    expect((await stop(dir))?.decision).toBe("block");
    expect(await readyRuns(wst)).toBe(2);
  });

  it("tells the user once, then goes quiet, when a block is followed by a stop with nothing edited", async () => {
    const wst = await fakeWst({ exit: 1, stdout: envelope("NOT_READY") });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "1\n");
    expect((await stop(dir))?.decision).toBe("block");

    const again = await stop(dir, '{"stop_hook_active":true}');

    expect(again?.decision).toBeUndefined();
    expect(again?.systemMessage).toContain("still NOT_READY");
    expect(again?.systemMessage).toContain("nothing has changed");
    expect(await stop(dir, '{"stop_hook_active":true}')).toBeNull();
    expect(await readyRuns(wst)).toBe(1);
  });

  it("does not reopen the turn for an INCOMPLETE that only lacks coverage", async () => {
    await fakeWst({ exit: 2, stdout: UNCOVERED });
    const dir = await repo();
    await writeFile(join(dir, "a.md"), "x\n");

    const out = await stop(dir);

    expect(out?.hookSpecificOutput).toBeUndefined();
    expect(out?.systemMessage).toContain("no check covers");
  });

  it("still tells the agent once when a check could not run", async () => {
    const wst = await fakeWst({
      exit: 2,
      stdout: envelope("INCOMPLETE", { reason: "1 check could not run", applicable: ["lint"], results: [{ id: "lint", status: "errored", detail: ["spawn eslint ENOENT"] }] }),
    });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "1\n");

    const out = await stop(dir);

    expect(out?.hookSpecificOutput?.additionalContext).toContain("not fully verified");
    expect(out?.hookSpecificOutput?.additionalContext).toContain("ERROR lint (could not run)");
    expect(await stop(dir)).toBeNull();
    expect(await readyRuns(wst)).toBe(1);
  });

  it("keeps a declined check visible to the agent", async () => {
    await fakeWst({ exit: 2, stdout: envelope("INCOMPLETE", { reason: "x", uncovered: ["a.md"], declined: ["lens"] }) });
    const dir = await repo();
    await writeFile(join(dir, "a.md"), "x\n");

    expect((await stop(dir))?.hookSpecificOutput?.additionalContext).toContain("not fully verified");
  });

  it("gives the early INCOMPLETE, which has no uncovered field, to the agent", async () => {
    await fakeWst({ exit: 2, stdout: JSON.stringify({ result: "INCOMPLETE", reason: "unresolved conflicts: a.ts", conflicts: ["a.ts"], results: [] }) });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "x\n");

    expect((await stop(dir))?.hookSpecificOutput?.additionalContext).toContain("unresolved conflicts");
  });

  it("notices a kill once and runs again on the next stop", async () => {
    const runs = await countingKiller();
    const dir = await repo();

    const first = await stop(dir);
    const second = await stop(dir);

    expect(first?.hookSpecificOutput?.additionalContext).toContain("did not finish");
    expect(second).toBeNull();
    expect((await readFile(runs, "utf-8")).trim().split("\n")).toHaveLength(2);
  });

  it("keeps separate state per worktree", async () => {
    const wst = await fakeWst({ exit: 0, stdout: envelope("READY") });
    const dir = await repo();
    const other = join(await tempDir("wst-tree-"), "tree");
    await git(dir, "worktree", "add", "-q", "-b", "other", other);
    await mkdir(join(other, ".wst"), { recursive: true });

    await stop(dir);
    await stop(other);
    await stop(dir);
    await stop(other);

    expect(await readyRuns(wst)).toBe(2);
  });

  it("neither crashes nor changes the verdict when the state file is broken", async () => {
    await fakeWst({ exit: 1, stdout: envelope("NOT_READY") });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "1\n");
    await stop(dir);
    const { stdout } = await exec("git", ["rev-parse", "--git-path", "wst-stop-state.json"], { cwd: dir });
    const file = join(dir, stdout.trim());

    await writeFile(file, "{not json");
    expect((await stop(dir))?.decision).toBe("block");

    await rm(file);
    await mkdir(file);
    expect((await stop(dir))?.decision).toBe("block");
  });

  it("behaves as before, with no memory, outside a git repo", async () => {
    const wst = await fakeWst({ exit: 1, stdout: envelope("NOT_READY") });
    const dir = await project(true);

    expect((await stop(dir))?.decision).toBe("block");
    expect((await stop(dir))?.decision).toBe("block");
    expect(await readyRuns(wst)).toBe(2);
  });

  it("blocks with the raw output when wst exits 1 without valid JSON", async () => {
    await fakeWst({ exit: 1, stdout: "NOT_READY\n  FAIL test\n" });
    const dir = await repo();
    await writeFile(join(dir, "a.ts"), "1\n");

    const out = await stop(dir);

    expect(out?.decision).toBe("block");
    expect((out as { reason?: string }).reason).toContain("NOT_READY\n  FAIL test");
  });
});
