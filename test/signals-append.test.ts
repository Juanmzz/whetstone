/**
 * What the emitter actually WRITES, round-tripped through the parser that reads it.
 *
 * `src/shell/` is integration-tested rather than unit-tested (triage-rules.md), and
 * a temp directory is the whole integration here: the adapter appends a line, the
 * fail-closed parser reads it back. Writer and reader disagreeing about the record
 * shape is the failure this catches — the log would look fine until the next retro
 * refused to load it.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EmittableSignal } from "../src/core/signals/emit.js";
import { parseSignalLog } from "../src/core/signals/parse.js";
import { appendSignals, SIGNALS_PATH } from "../src/shell/signals.js";

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
