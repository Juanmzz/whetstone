/**
 * `wst signal` at the boundary: a real repository, a real filesystem, real exit
 * codes. `src/commands/` is light tier and carries no test ceremony by default —
 * these two cases earn it because both END in a human losing what they typed, and
 * neither is reachable from a pure test of `core/signals/human.ts`.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSignal } from "../src/commands/signal.js";
import { isolateFromInheritedGit } from "./git-env.js";
import { tempDir } from "./tmp.js";

// The pre-push hook exports GIT_DIR to everything it spawns, so a temp repo built
// here reports WHETSTONE as its root and `--resolve` writes nowhere. Two cases
// below already expected a nonzero exit and were immune by accident.
isolateFromInheritedGit();

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
  const dir = await tempDir("wst-signal-cmd-");
  await run("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** The one line of JSON, wherever the command chose to print it. */
const record = (): Record<string, unknown> =>
  JSON.parse(
    [...out, ...err].find((l) => l.trimStart().startsWith("{")) ?? "null",
  ) as Record<string, unknown>;

describe("a repository with no .wst/", () => {
  it("refuses, the way every other command that touches .wst/ refuses", async () => {
    // `appendSignalRecord` creates its parents. Without a guard an uninitialised
    // repo gets a fabricated memory tree and a success message — and then
    // `wst init` refuses to bootstrap over the stray file, and `init --force`
    // deletes it.
    const dir = await repo();
    expect(await runSignal(observation, dir)).toBe(2);
    await expect(readFile(join(dir, ".wst/memory/signals.jsonl"), "utf-8")).rejects.toThrow();
  });

  it("still prints the record, because the human already typed it", async () => {
    await runSignal(observation, await repo());
    expect(record()["detail"]).toBe(observation.detail);
  });

  it("but --dry-run needs no .wst/ — it writes nothing to begin with", async () => {
    expect(await runSignal({ ...observation, dryRun: true }, await repo())).toBe(0);
  });
});

describe("a write that fails", () => {
  /** `.wst/memory` as a FILE: the same ENOTDIR a read-only or full disk produces. */
  async function unwritable(): Promise<string> {
    const dir = await repo();
    await mkdir(join(dir, ".wst"), { recursive: true });
    await writeFile(join(dir, ".wst/memory"), "not a directory", "utf-8");
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

/**
 * `--resolve` writes over a stored line, which no other path here does. A refusal
 * that still rewrites is invisible to a pure test of `markResolved`.
 */
describe("marking a stored signal answered", () => {
  const log = [
    JSON.stringify({ id: "sig-0001", ts: "2026-08-01T00:00:00Z", type: "a", phase: "apply", severity: "low", detail: "one" }),
    JSON.stringify({ id: "sig-0002", ts: "2026-08-02T00:00:00Z", type: "b", phase: "apply", severity: "low", detail: "two" }),
  ].join("\n") + "\n";

  async function seeded(): Promise<string> {
    const dir = await repo();
    await mkdir(join(dir, ".wst/memory"), { recursive: true });
    await writeFile(join(dir, ".wst/memory/signals.jsonl"), log, "utf-8");
    return dir;
  }

  const read = async (dir: string): Promise<string> =>
    readFile(join(dir, ".wst/memory/signals.jsonl"), "utf-8");

  it("records the answer and leaves the neighbouring line alone", async () => {
    const dir = await seeded();
    expect(await runSignal({ type: "", detail: "", resolve: "sig-0002", by: "pr-107" }, dir)).toBe(0);
    const lines = (await read(dir)).trim().split("\n");
    expect(lines[0]).toBe(log.trim().split("\n")[0]);
    expect(JSON.parse(lines[1] ?? "null")).toMatchObject({ id: "sig-0002", resolved_by: "pr-107" });
  });

  it("refuses an unknown id and writes nothing at all", async () => {
    const dir = await seeded();
    expect(await runSignal({ type: "", detail: "", resolve: "sig-9999", by: "pr-107" }, dir)).toBe(1);
    expect(await read(dir)).toBe(log);
  });

  it("refuses without --by, rather than recording an empty answer", async () => {
    const dir = await seeded();
    expect(await runSignal({ type: "", detail: "", resolve: "sig-0001" }, dir)).toBe(1);
    expect(await read(dir)).toBe(log);
  });

  it("refuses on a repo with no .wst/, like every other path here", async () => {
    expect(await runSignal({ type: "", detail: "", resolve: "sig-0001", by: "x" }, await repo())).toBe(2);
  });
});
