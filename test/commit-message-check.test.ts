/**
 * `wst check run commit-message` against a real repository.
 *
 * The rules are unit-tested in `src/core/checks/commit-message.test.ts`. What is
 * only reachable here is the READING: a body holds newlines, a subject holds
 * anything, and a parser that quietly returns nothing turns a blocking check
 * into one that passes everything.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShippedCheck } from "../src/commands/run.js";
import { isolateFromInheritedGit } from "./git-env.js";
import { tempDir } from "./tmp.js";

isolateFromInheritedGit();

const run = promisify(execFile);

let err: string[];
beforeEach(() => {
  err = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  delete process.env["WST_GATE_RANGE"];
});
afterEach(() => void vi.restoreAllMocks());

async function repo(): Promise<string> {
  const dir = await tempDir("wst-commit-msg-");
  await run("git", ["init", "-q"], { cwd: dir });
  await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await run("git", ["config", "user.name", "T"], { cwd: dir });
  // A root commit, so `HEAD~n` resolves in the tests that need a range.
  await run("git", ["commit", "-q", "--allow-empty", "-m", "chore: root"], { cwd: dir });
  return dir;
}

async function commit(dir: string, message: string): Promise<void> {
  await run("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd: dir });
}

describe("wst check run commit-message", () => {
  it("passes a conventional subject", async () => {
    const dir = await repo();
    await commit(dir, "feat(gate): a thing");

    expect(await runShippedCheck("commit-message", dir)).toBe(0);
  });

  it("fails a subject with no type", async () => {
    const dir = await repo();
    await commit(dir, "just did a thing");

    expect(await runShippedCheck("commit-message", dir)).toBe(1);
  });

  it("reads a multi-line body without losing the commits after it", async () => {
    // The parse this exists for. A body with blank lines and a colon in it used
    // to be indistinguishable from the next record.
    const dir = await repo();
    await commit(dir, "feat: first\n\nA body with a blank line.\n\nNote: and a trailer-looking line.");
    await commit(dir, "nope");
    process.env["WST_GATE_RANGE"] = "HEAD~2..HEAD";

    expect(await runShippedCheck("commit-message", dir)).toBe(1);
    expect(err.join("\n")).toContain("2 commit message(s)");
  });

  it("catches the attribution trailer in a body across a range", async () => {
    const dir = await repo();
    await commit(dir, "feat: fine");
    await commit(dir, "fix: also fine\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    process.env["WST_GATE_RANGE"] = "HEAD~2..HEAD";

    expect(await runShippedCheck("commit-message", dir)).toBe(1);
    expect(err.join("\n")).toContain("ai-attribution");
  });

  it("skips merge commits, whose subject git writes rather than a person", async () => {
    const dir = await repo();
    await commit(dir, "feat: base");
    await run("git", ["checkout", "-q", "-b", "side"], { cwd: dir });
    await commit(dir, "feat: on the side");
    await run("git", ["checkout", "-q", "-"], { cwd: dir });
    await commit(dir, "feat: on the trunk");
    await run("git", ["merge", "--no-ff", "-q", "-m", "Merge branch 'side'", "side"], { cwd: dir });
    process.env["WST_GATE_RANGE"] = "HEAD~3..HEAD";

    expect(await runShippedCheck("commit-message", dir)).toBe(0);
  });

  it("reports it could not run rather than passing, when the range does not resolve", async () => {
    // Hard rule 3, as far as this layer can carry it: a check that could not READ
    // the commits has not cleared them. The GATE cannot see the difference, since
    // `interpretCommandResult` treats every non-zero but 126/127 as a failure, and
    // widening that would turn `tsc`'s own exit 2 into a broken gate.
    const dir = await repo();
    await commit(dir, "feat: a thing");
    process.env["WST_GATE_RANGE"] = "no-such-ref..HEAD";

    expect(await runShippedCheck("commit-message", dir)).toBe(2);
  });
});
