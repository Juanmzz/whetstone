/**
 * `wst events` at the boundary: a real repository, a real log file, real exit codes.
 *
 * `src/commands/` is light tier and carries no test ceremony by default — the
 * decisions this command makes live in `src/core/events/`, which is strict and
 * tested there. These cases earn a place because none of them is reachable from a
 * pure test:
 *
 * - the EXIT CODE, which is the whole of hard rule 3 as it applies to a reader;
 * - what happens when the log is CORRUPT, where the requirement is negative — the
 *   run must not be rendered — and a pure test cannot observe a render that did
 *   not happen;
 * - what happens when there is no log at all, which must not be an error.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEvents } from "../src/commands/events.js";

const git = promisify(execFile);

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});

afterEach(() => void vi.restoreAllMocks());

/** A repo with a definition directory and, optionally, a log in it. */
async function repo(log?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wst-events-cmd-"));
  await git("git", ["init", "-q"], { cwd: dir });
  // Spelled out rather than built from DEFINITION_DIR: this is what pins the
  // constant's value, which is why `test/definition-dir.test.ts` exempts tests.
  await mkdir(join(dir, ".wst"), { recursive: true });
  if (log !== undefined) await writeFile(join(dir, ".wst", "events.jsonl"), log);
  return dir;
}

const line = (run: string, seq: number, kind: string, extra: object = {}): string =>
  JSON.stringify({
    run,
    seq,
    ts: `2026-08-12T14:00:0${seq}.000Z`,
    kind,
    detail: kind,
    ...extra,
  });

const passingRun = [
  line("run-aaaa1111", 0, "run-started", { detail: "wst gate --range HEAD" }),
  line("run-aaaa1111", 1, "run-finished", { detail: "passed — 2 check(s)", status: "pass", exit: 0 }),
].join("\n");

const printed = (): string => out.join("\n");

describe("wst events", () => {
  it("renders the most recent run when asked for nothing in particular", async () => {
    const dir = await repo(
      [
        line("run-old00001", 0, "run-started", { ts: "2026-08-12T10:00:00.000Z" }),
        line("run-new00002", 0, "run-started"),
        line("run-new00002", 1, "run-finished", { status: "pass", exit: 0 }),
      ].join("\n"),
    );
    expect(await runEvents({}, dir)).toBe(0);
    expect(printed()).toContain("run-new00002");
    expect(printed()).not.toContain("run-old00001");
  });

  it("exits 0 for a run that BLOCKED, because reading it is what succeeded", async () => {
    // Hard rule 3, aimed at a reader. Exit 1 here would make a script that merely
    // LOOKED at a blocked run believe something of its own had been rejected.
    const dir = await repo(
      [
        line("run-bbbb2222", 0, "run-started"),
        line("run-bbbb2222", 1, "run-finished", { detail: "blocked by test", status: "block", exit: 1 }),
      ].join("\n"),
    );
    expect(await runEvents({}, dir)).toBe(0);
    expect(printed()).toContain("BLOCKED");
  });

  it("says no runs are recorded yet, and calls it a 0", async () => {
    // A repo that has not run the gate is not a broken repo.
    const dir = await repo();
    expect(await runEvents({}, dir)).toBe(0);
    expect(printed()).toContain("no runs recorded yet");
    expect(err).toEqual([]);
  });

  it("treats an empty log the same as an absent one", async () => {
    const dir = await repo("");
    expect(await runEvents({}, dir)).toBe(0);
    expect(printed()).toContain("no runs recorded yet");
  });

  it("reports a corrupt log as corrupt, names the line, and renders no run at all", async () => {
    // The failure this forbids: dropping the unreadable lines and rendering what is
    // left. A log that stops parsing at line 2 and a run that STOPPED at line 2 are
    // then indistinguishable — which is the false conclusion `parse.ts` fails
    // closed to prevent, undone one layer up.
    const dir = await repo(`${passingRun.split("\n")[0] as string}\nnot json\n`);
    expect(await runEvents({}, dir)).toBe(2);
    expect(err.join("\n")).toMatch(/line 2/);
    expect(printed()).not.toContain("run-aaaa1111");
    expect(printed()).toBe("");
  });

  it("refuses an unknown run id rather than falling back to the newest", async () => {
    // A fallback would answer a question about run X with run Y's timeline, and the
    // output would be indistinguishable from a correct answer.
    const dir = await repo(passingRun);
    expect(await runEvents({ run: "run-nope" }, dir)).toBe(2);
    expect(printed()).toBe("");
    expect(err.join("\n")).toContain("--list");
  });

  it("finds a run by a prefix of its id", async () => {
    const dir = await repo(passingRun);
    expect(await runEvents({ run: "run-aaaa" }, dir)).toBe(0);
    expect(printed()).toContain("run-aaaa1111");
  });

  it("lists every run, newest first", async () => {
    const dir = await repo(
      [
        line("run-old00001", 0, "run-started", { ts: "2026-08-12T10:00:00.000Z" }),
        line("run-new00002", 0, "run-started"),
      ].join("\n"),
    );
    expect(await runEvents({ list: true }, dir)).toBe(0);
    expect(printed().indexOf("run-new00002")).toBeLessThan(printed().indexOf("run-old00001"));
  });

  it("publishes the reading in --json, so a consumer need not re-derive it", async () => {
    // The trap: `status: "pass"` next to `exit: 2`. A JSON consumer that reads
    // `status` alone concludes the run passed; `reading` is what stops that.
    const dir = await repo(
      [
        line("run-cccc3333", 0, "run-started"),
        line("run-cccc3333", 1, "run-finished", { detail: "passed — 0 check(s)", status: "pass", exit: 2 }),
      ].join("\n"),
    );
    expect(await runEvents({ json: true }, dir)).toBe(0);
    const parsed = JSON.parse(printed()) as { reading: string; events: unknown[] };
    expect(parsed.reading).toBe("incomplete");
    expect(parsed.events).toHaveLength(2);
  });

  it("refuses --follow together with --list instead of quietly ignoring one", async () => {
    const dir = await repo(passingRun);
    expect(await runEvents({ list: true, follow: true }, dir)).toBe(2);
  });

  it("follows a run that has already ended, and returns instead of hanging", async () => {
    // You cannot know a run finished until you look. Tailing one that is already
    // over is the ordinary case, not an error — but it must not sit on a watcher
    // waiting for a line that will never come.
    const dir = await repo(passingRun);
    expect(await runEvents({ follow: true }, dir)).toBe(0);
    expect(printed()).toContain("following");
    expect(printed()).toContain("passed");
  });

  it("is not fooled by a repo that has no definition directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wst-events-bare-"));
    await git("git", ["init", "-q"], { cwd: dir });
    expect(await runEvents({}, dir)).toBe(0);
    expect(printed()).toContain("no runs recorded yet");
  });
});
