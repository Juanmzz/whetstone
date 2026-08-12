/**
 * The event log adapter against a real filesystem. The pure half is unit-tested in
 * `src/core/events/`; what only a real disk can show is here.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseEventLog } from "../src/core/events/parse.js";
import { createEventLog, EVENTS_PATH, readEventLog } from "../src/shell/events.js";

const roots: string[] = [];
const root = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "wst-events-"));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  roots.length = 0;
});

const at = (ms: number) => (): Date => new Date(Date.parse("2026-08-12T14:00:00Z") + ms);

describe("createEventLog", () => {
  it("creates the log on first write and appends one line per event", async () => {
    const dir = await root();
    const log = createEventLog(dir, "seed", at(0));
    log.sink({ kind: "run-started", detail: "wst gate --range HEAD" });
    log.sink({ kind: "run-finished", detail: "passed", exit: 0 });
    expect(await log.drain()).toBeNull();

    const records = await readEventLog(dir);
    expect(records.map((e) => e.kind)).toEqual(["run-started", "run-finished"]);
    expect(records.every((e) => e.run === log.run)).toBe(true);
  });

  it("numbers events in the order they were OBSERVED, not the order they landed", async () => {
    // `seq` is stamped synchronously in `sink`; the writes are queued behind it. If
    // the number came from the write, a slow first append would renumber the run.
    const dir = await root();
    const log = createEventLog(dir, "seed", at(0));
    for (const kind of ["run-started", "triage-classified", "run-finished"] as const) {
      log.sink({ kind, detail: kind });
    }
    await log.drain();
    expect((await readEventLog(dir)).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("serialises concurrent writes instead of interleaving them into one line", async () => {
    // The deterministic checks run under `Promise.all`, so this is the ordinary
    // case, not a stress test. Two unserialised `appendFile`s weld two records
    // together and the parser — correctly — rejects the whole log.
    const dir = await root();
    const log = createEventLog(dir, "seed", at(0));
    for (let i = 0; i < 40; i++) {
      log.sink({ kind: "check-finished", detail: `check ${i}`, check: `c${i}`, status: "pass" });
    }
    await log.drain();

    const text = await readFile(join(dir, EVENTS_PATH), "utf-8");
    expect(() => parseEventLog(text)).not.toThrow();
    expect(parseEventLog(text)).toHaveLength(40);
  });

  it("does not weld a new line onto a log that ends without a newline", async () => {
    // A process killed mid-append leaves exactly this. Surviving a crash is half
    // of what an event log is for, so the next run must not corrupt what it finds.
    const dir = await root();
    await writeFile(
      join(dir, EVENTS_PATH),
      JSON.stringify({ run: "run-00000000", seq: 0, ts: "2026-08-12T14:00:00.000Z", kind: "run-started", detail: "x" }),
      "utf-8",
    );
    const log = createEventLog(dir, "seed", at(0));
    log.sink({ kind: "run-finished", detail: "passed", exit: 0 });
    await log.drain();

    expect(await readEventLog(dir)).toHaveLength(2);
  });

  it("reports a write it could not make instead of throwing at the caller", async () => {
    // The gate's verdict is the product. A log that can fail a gate is worse than
    // no log, so the failure comes back through `drain` as a message to print.
    const blocked = join(await root(), "not-a-dir");
    await writeFile(blocked, "", "utf-8"); // a FILE where the definition root should be
    const log = createEventLog(blocked, "seed", at(0));
    log.sink({ kind: "run-started", detail: "x" });
    expect(await log.drain()).toMatch(/ENOTDIR|EEXIST|not a directory/i);
  });

  it("gives two runs of the same command different ids", async () => {
    const dir = await root();
    expect(createEventLog(dir, "gate|HEAD|t1", at(0)).run).not.toBe(
      createEventLog(dir, "gate|HEAD|t2", at(0)).run,
    );
  });
});

describe("readEventLog", () => {
  it("reads a missing log as empty", async () => {
    expect(await readEventLog(await root())).toEqual([]);
  });

  it("throws on a corrupt log rather than reporting a run that stopped early", async () => {
    const dir = await root();
    await writeFile(join(dir, EVENTS_PATH), "not json\n", "utf-8");
    await expect(readEventLog(dir)).rejects.toThrow(/line 1/);
  });
});
