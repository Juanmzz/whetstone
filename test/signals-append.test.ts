/**
 * What the emitter actually WRITES, round-tripped through the parser that reads it.
 *
 * `src/shell/` is integration-tested rather than unit-tested (triage-rules.md), and
 * a temp directory is the whole integration here: the adapter appends a line, the
 * fail-closed parser reads it back. Writer and reader disagreeing about the record
 * shape is the failure this catches — the log would look fine until the next retro
 * refused to load it.
 */

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EmittableSignal } from "../src/core/signals/emit.js";
import { parseSignalLog, type SignalRecord } from "../src/core/signals/parse.js";
import { appendSignalRecord, appendSignals, SIGNALS_PATH } from "../src/shell/signals.js";

const signal: EmittableSignal = {
  type: "gate-blocked",
  phase: "verify",
  severity: "medium",
  detail: "`test` blocked a change",
  source: "gate",
  fingerprint: "gate-blocked:test:1",
};

const NOW = new Date("2026-08-10T12:00:00.000Z");

async function emitInto(branch: string | null): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "wst-signals-"));
  await appendSignals(root, [signal], NOW, branch);
  const text = await readFile(join(root, SIGNALS_PATH), "utf-8");
  // Through the real parser, not JSON.parse: a line the parser rejects is a line
  // that has poisoned the log for every reader downstream.
  expect(parseSignalLog(text)).toHaveLength(1);
  return JSON.parse(text.trim()) as Record<string, unknown>;
}

describe("appendSignals", () => {
  it("records the branch the gate ran on", async () => {
    expect((await emitInto("run/two-related-repairs")).branch).toBe("run/two-related-repairs");
  });

  it("omits the field entirely on a detached HEAD rather than writing a null", async () => {
    // `null` reads as data that is present and empty. Absent reads as unknown,
    // which is the truth, and it is what the 45 older entries already look like.
    expect("branch" in (await emitInto(null))).toBe(false);
  });
});

const human: SignalRecord = {
  id: "sig-deadbeef",
  ts: NOW.toISOString(),
  type: "triage-miss",
  phase: "verify",
  severity: "medium",
  detail: "typed by a human",
  rule_affected: [],
  source: "human",
};

/**
 * A log whose last line has no newline after it, which is what an editor that does
 * not add a final newline leaves behind. Hand-editing is the DOCUMENTED workflow —
 * 45 of this repo's entries were written that way — so this is the ordinary state
 * of the file, not an exotic one.
 */
async function seedUnterminated(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wst-signals-"));
  const path = join(root, SIGNALS_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...human, id: "sig-00000001" })}`, "utf-8");
  return root;
}

describe("appending to a log with no trailing newline", () => {
  // Concatenating two JSON objects onto one line does not corrupt one entry, it
  // corrupts the WHOLE log: the parser fails closed, so the retro stops and the
  // gate stops emitting until a human repairs the file by hand. And the file is
  // append-only, so the damage is not editable away without rewriting history.

  it("does not weld the gate's signal onto the last hand-written line", async () => {
    const root = await seedUnterminated();
    await appendSignals(root, [signal], NOW, "run/x");
    const text = await readFile(join(root, SIGNALS_PATH), "utf-8");
    expect(parseSignalLog(text)).toHaveLength(2);
  });

  it("does not weld a human's record onto it either", async () => {
    const root = await seedUnterminated();
    await appendSignalRecord(root, human);
    const text = await readFile(join(root, SIGNALS_PATH), "utf-8");
    expect(parseSignalLog(text)).toHaveLength(2);
  });

  it("adds no blank line to a log that is already terminated", async () => {
    // The guard must be conditional. An unconditional newline grows a blank line
    // per append, and while the parser skips those, the file stops being readable.
    const root = await mkdtemp(join(tmpdir(), "wst-signals-"));
    await appendSignalRecord(root, human);
    await appendSignalRecord(root, { ...human, id: "sig-00000002" });
    const text = await readFile(join(root, SIGNALS_PATH), "utf-8");
    expect(text.split("\n")).toHaveLength(3); // two records, one trailing empty
    expect(parseSignalLog(text)).toHaveLength(2);
  });
});
