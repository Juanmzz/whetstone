/**
 * The fail-closed parser, proven in BOTH directions against the REAL log (TD7).
 *
 * A guard that fails closed on real work is worse than no guard: it gets routed
 * around, and here "routed around" means someone deletes the throw and we are back
 * to a corrupt line reading as an empty log. So the acceptance half of this test —
 * every entry this repo has actually accumulated parses unchanged — is the load
 * bearing half, and it uses the real file rather than a fixture on purpose.
 *
 * It lives in `test/` and not next to `parse.ts` because `test/architecture.test.ts`
 * bans `node:fs` anywhere under `src/core/`, test files included.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSignalLog } from "../src/core/signals/parse.js";

const LOG = join(import.meta.dirname, "..", ".sdd", "memory", "signals.jsonl");

describe("parseSignalLog against .sdd/memory/signals.jsonl", () => {
  it("accepts every entry the real log has accumulated", async () => {
    const text = await readFile(LOG, "utf-8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(30);

    const parsed = parseSignalLog(text);
    expect(parsed).toHaveLength(lines.length);
    expect(parsed.map((s) => s.id)).toEqual(
      lines.map((l) => (JSON.parse(l) as { id: string }).id),
    );
  });

  it("rejects the real log with a single line corrupted, naming that line", async () => {
    const text = await readFile(LOG, "utf-8");
    // The parser stops at the FIRST corrupt line, so this test only means what it
    // says if the log starts clean. Assert that separately rather than letting a
    // pre-existing corruption elsewhere in the file pass as "the guard fired".
    expect(() => parseSignalLog(text)).not.toThrow();

    const lines = text.split("\n");
    // Prove the mutation landed before trusting the rejection (TD7): the line must
    // really have become unparseable, or a green "it blocked" means nothing.
    const target = 5;
    expect(() => JSON.parse(lines[target] ?? "")).not.toThrow();
    lines[target] = `${lines[target]?.slice(0, -3) ?? ""}`;
    expect(() => JSON.parse(lines[target] ?? "")).toThrow();

    expect(() => parseSignalLog(lines.join("\n"))).toThrow(`line ${target + 1}`);
  });
});
