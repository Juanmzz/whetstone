/**
 * Calibration harness — ADR-0008's pre-registered kill criterion.
 *
 * The whole design rests on one unmeasured assumption: that an `agent-lens` verdict
 * is stable enough to gate on. A flaky check that blocks legitimate work is worse
 * than no check, because the user routes around it and the gate's value goes
 * negative.
 *
 * THE BAR (recorded before this was first run, so it cannot be fitted to the result):
 *   correct AND unanimous — N/N on a known-good AND a known-bad fixture, zero flips.
 * Anything less is capped at `warn`/`annotate`.
 *
 * Stability alone is not enough: a lens that stably passes everything is perfectly
 * stable and completely useless. Hence the known-bad fixture.
 *
 *   npm run calibrate  [-- --runs 10 --model sonnet]
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createClaudeJudge } from "../src/shell/claude.js";

const LensVerdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
});

const LENS = [
  "You are a correctness review lens for a code gate.",
  "Given a diff, decide whether it INTRODUCES a correctness bug.",
  "verdict='fail' means the diff introduces a bug. verdict='pass' means it does not.",
  "Judge only the change itself, not the surrounding file. Be decisive.",
].join(" ");

const FIXTURES = [
  { name: "known-bad", file: "known-bad.diff", expect: "fail" as const },
  { name: "known-good", file: "known-good.diff", expect: "pass" as const },
];

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const RUNS = Number(arg("--runs", "10"));
const MODEL = arg("--model", "sonnet") as "haiku" | "sonnet" | "opus";
const CONCURRENCY = 4;

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

async function main() {
  const judge = createClaudeJudge();
  const { version } = await judge.describe();
  const dir = join(import.meta.dirname, "..", "test", "fixtures", "lens-correctness");

  console.log(`calibrating — claude ${version ?? "?"} · model ${MODEL} · ${RUNS} runs/fixture\n`);

  let totalCost = 0;
  let allPassed = true;

  for (const fixture of FIXTURES) {
    const diff = await readFile(join(dir, fixture.file), "utf-8");

    const outcomes = await pool(Array.from({ length: RUNS }, (_, i) => i), CONCURRENCY, async () => {
      const r = await judge.judge({
        lens: LENS,
        prompt: `Review this diff.\n\n${diff}`,
        schema: LensVerdict,
        model: MODEL,
        maxAttempts: 3,
      });
      totalCost += r.costUsd;
      if (!r.ok) console.error(`    ! ${r.error.kind}: ${r.error.detail.slice(0, 160)}`);
      return r.ok ? r.value.verdict : `ERROR:${r.error.kind}`;
    });

    const tally = new Map<string, number>();
    for (const o of outcomes) tally.set(o, (tally.get(o) ?? 0) + 1);

    const correct = outcomes.filter((o) => o === fixture.expect).length;
    const unanimous = tally.size === 1;
    const passed = correct === RUNS;
    if (!passed) allPassed = false;

    const spread = [...tally.entries()].map(([v, n]) => `${v}×${n}`).join(", ");
    console.log(
      `  ${fixture.name.padEnd(11)} expect=${fixture.expect.padEnd(4)} ` +
        `correct=${correct}/${RUNS}  ${unanimous ? "unanimous" : "FLIPPED"}  [${spread}]`,
    );
  }

  console.log(`\n  cost  $${totalCost.toFixed(4)}`);
  console.log(
    allPassed
      ? "\n  PASS — this lens may be declared `severity: block`."
      : "\n  FAIL — this lens is capped at `warn`/`annotate` (ADR-0008).",
  );
  process.exitCode = allPassed ? 0 : 1;
}

await main();
