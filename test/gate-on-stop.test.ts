/**
 * The Stop hook, spawned as the harness runs it, against a fake `wst` on PATH.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeBin, restorePath } from "./fake-bin.js";
import { tempDir } from "./tmp.js";

const exec = promisify(execFile);
const HOOK = join(import.meta.dirname, "..", "plugin", "hooks", "gate-on-stop.mjs");

interface HookOutput {
  readonly decision?: string;
  readonly hookSpecificOutput?: { readonly hookEventName?: string; readonly additionalContext?: string };
}

async function stop(root: string): Promise<HookOutput | null> {
  const child = exec(HOOK, [], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  child.child.stdin?.end("{}");
  const { stdout } = await child;
  return stdout.trim() === "" ? null : (JSON.parse(stdout) as HookOutput);
}

async function project(withDefinitions: boolean): Promise<string> {
  const dir = await tempDir("wst-stop-");
  if (withDefinitions) await mkdir(join(dir, ".wst"));
  return dir;
}

describe("the gate-on-stop hook", () => {
  afterEach(restorePath);

  it("tells the agent nothing was verified when the gate could not run", async () => {
    await installFakeBin("wst", { exit: 2, stderr: "whetstone crashed before it could finish.\n" });

    const out = await stop(await project(true));

    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(out?.hookSpecificOutput?.additionalContext).toContain("NOT verified");
    expect(out?.hookSpecificOutput?.additionalContext).toContain("whetstone crashed");
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
});
