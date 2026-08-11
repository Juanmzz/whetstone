/**
 * `wst signal` at the boundary: a real repository, a real filesystem, real exit
 * codes. `src/commands/` is light tier and carries no test ceremony by default —
 * these two cases earn it because both END in a human losing what they typed, and
 * neither is reachable from a pure test of `core/signals/human.ts`.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSignal } from "../src/commands/signal.js";

const run = promisify(execFile);

const observation = {
  type: "triage-miss",
  detail: "Auth middleware change classified light; it should have been strict.",
};

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});

afterEach(() => void vi.restoreAllMocks());

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wst-signal-cmd-"));
  await run("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** The one line of JSON, wherever the command chose to print it. */
const record = (): Record<string, unknown> =>
  JSON.parse(
    [...out, ...err].find((l) => l.trimStart().startsWith("{")) ?? "null",
  ) as Record<string, unknown>;

describe("a repository with no .sdd/", () => {
  it("refuses, the way every other command that touches .sdd/ refuses", async () => {
    // `appendSignalRecord` creates its parents. Without a guard an uninitialised
    // repo gets a fabricated memory tree and a success message — and then
    // `wst init` refuses to bootstrap over the stray file, and `init --force`
    // deletes it.
    const dir = await repo();
    expect(await runSignal(observation, dir)).toBe(2);
    await expect(readFile(join(dir, ".sdd/memory/signals.jsonl"), "utf-8")).rejects.toThrow();
  });

  it("still prints the record, because the human already typed it", async () => {
    await runSignal(observation, await repo());
    expect(record()["detail"]).toBe(observation.detail);
  });

  it("but --dry-run needs no .sdd/ — it writes nothing to begin with", async () => {
    expect(await runSignal({ ...observation, dryRun: true }, await repo())).toBe(0);
  });
});

describe("a write that fails", () => {
  /** `.sdd/memory` as a FILE: the same ENOTDIR a read-only or full disk produces. */
  async function unwritable(): Promise<string> {
    const dir = await repo();
    await mkdir(join(dir, ".sdd"), { recursive: true });
    await writeFile(join(dir, ".sdd/memory"), "not a directory", "utf-8");
    return dir;
  }

  it("exits nonzero rather than throwing a stack trace at the human", async () => {
    expect(await runSignal(observation, await unwritable())).not.toBe(0);
  });

  it("names the cause and reprints the record so the words survive", async () => {
    await runSignal(observation, await unwritable());
    expect(err.join("\n")).toMatch(/could not write the signal/);
    expect(record()["detail"]).toBe(observation.detail);
  });
});
