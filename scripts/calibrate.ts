/**
 * Calibration harness — ADR-0008's pre-registered kill criterion.
 *
 * The whole design rests on one unmeasured assumption: that an `llm` verdict
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
 * The first run used exactly two fixtures, and they were mirror images of each other
 * (removing versus adding a null check) — unambiguous by construction. That measured
 * the harness, not the lens. So the fixture set is now DISCOVERED from the directory
 * and every `.diff` in it must be declared in `manifest.json` with an `expect` and a
 * one-sentence ground truth. A fixture nobody can label confidently is a coin flip and
 * does not belong here; a fixture nobody remembered to declare must not be silently
 * skipped, so an undeclared diff is a hard error rather than a warning.
 *
 *   npm run calibrate  [-- --runs 10 --model sonnet --filter race]
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createClaudeJudge } from "../src/shell/claude.js";
import { definitionRoot, loadRegistry } from "../src/shell/sdd.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { renderSlices, slicesOf } from "../src/core/calibration/slice.js";
import { hashFixtureDir, receiptName } from "../src/shell/calibration.js";
import { recordCalibration, type FixtureFile } from "../src/core/calibration/receipt.js";

const LensVerdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
});

/**
 * The lens is READ FROM THE CHECK REGISTRY, never copied here.
 *
 * This used to be a local constant with a "must stay in sync" comment, which is a receipt
 * integrity hole: if the two drift you calibrate one lens and ship another, and the
 * recorded `calibration:` block then vouches for text that never ran.
 */
async function loadLens(repoRoot: string, checkId: string): Promise<string> {
  const registry = await loadRegistry(definitionRoot(repoRoot));
  const check = registry.byId.get(checkId);
  if (!check) throw new Error(`no check "${checkId}" in ${DEFINITION_DIR}/checks/`);
  if (check.kind !== "llm" || check.review_lens === undefined) {
    throw new Error(`check "${checkId}" is not an llm check — nothing to calibrate`);
  }
  return check.review_lens;
}

const Manifest = z.object({
  fixtures: z
    .array(
      z.object({
        file: z.string().endsWith(".diff"),
        difficulty: z.enum(["easy", "medium", "hard"]),
        expect: z.enum(["pass", "fail"]),
        truth: z.string().min(20),
      }),
    )
    .min(1),
});
type Fixture = z.infer<typeof Manifest>["fixtures"][number];

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const RUNS = Number(arg("--runs", "10"));
const CHECK_ID = "correctness";
const MODEL = arg("--model", "sonnet") as "haiku" | "sonnet" | "opus";
const FILTER = arg("--filter", "");
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

/**
 * The fixture set is the directory, not a list in this file. Declaring it here is how
 * the two drift apart: someone adds a hard fixture, forgets the array, and the run
 * reports a clean pass it never earned.
 */
async function loadFixtures(dir: string): Promise<Fixture[]> {
  const manifest = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8")));
  const onDisk = (await readdir(dir)).filter((f) => f.endsWith(".diff")).sort();
  const declared = new Set(manifest.fixtures.map((f) => f.file));

  const undeclared = onDisk.filter((f) => !declared.has(f));
  const missing = manifest.fixtures.filter((f) => !onDisk.includes(f.file)).map((f) => f.file);
  if (undeclared.length > 0 || missing.length > 0) {
    const parts = [
      undeclared.length > 0 ? `undeclared in manifest.json: ${undeclared.join(", ")}` : "",
      missing.length > 0 ? `declared but absent: ${missing.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`fixture set is inconsistent — ${parts.join("; ")}`);
  }

  const ordered = onDisk.map((f) => manifest.fixtures.find((m) => m.file === f)!);
  return FILTER ? ordered.filter((f) => f.file.includes(FILTER)) : ordered;
}

interface Outcome {
  fixture: Fixture;
  /** Correct verdicts out of RUNS. An error counts as not-correct — see the pass rule. */
  correct: number;
  /** Runs that never produced a verdict at all (after `maxAttempts` retries). */
  errors: number;
  /** True iff the runs that DID return a verdict disagreed with each other. */
  flipped: boolean;
  unanimous: boolean;
  spread: string;
  /** Raw per-run outcome, in order. The receipt records these, not a score. */
  verdicts: readonly ("pass" | "fail" | "errored")[];
}

/**
 * The fixture set as `FixtureFile[]`, hashed the same way the loader hashes it.
 *
 * It reads through `hashFixtureDir` first and refuses when that returns null: if the
 * loader cannot hash this directory, a receipt minted here could never be honoured,
 * and writing one anyway produces a file that silently never grants anything.
 */
async function fixtureFiles(dir: string): Promise<FixtureFile[]> {
  if ((await hashFixtureDir(dir)) === null) {
    throw new Error(`refusing to mint a receipt: ${dir} does not hash — fix the manifest first`);
  }
  const manifest = Manifest.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8")));
  const { createHash } = await import("node:crypto");
  return Promise.all(
    manifest.fixtures.map(async (f) => ({
      path: f.file,
      expected: f.expect,
      hash: createHash("sha256").update(await readFile(join(dir, f.file), "utf-8"), "utf8").digest("hex"),
    })),
  );
}

async function main() {
  const judge = createClaudeJudge();
  const { version } = await judge.describe();
  const repoRoot = join(import.meta.dirname, "..");
  const LENS = await loadLens(repoRoot, "correctness");
  const dir = join(repoRoot, "test", "fixtures", "lens-correctness");
  const fixtures = await loadFixtures(dir);

  if (fixtures.length === 0) throw new Error(`no fixtures matched --filter ${FILTER}`);

  console.log(
    `calibrating — claude ${version ?? "?"} · model ${MODEL} · ` +
      `${fixtures.length} fixtures × ${RUNS} runs = ${fixtures.length * RUNS} calls\n`,
  );

  const nameWidth = Math.max(...fixtures.map((f) => f.file.length));
  let totalCost = 0;
  const outcomes: Outcome[] = [];

  for (const fixture of fixtures) {
    const diff = await readFile(join(dir, fixture.file), "utf-8");

    const verdicts = await pool(Array.from({ length: RUNS }, (_, i) => i), CONCURRENCY, async () => {
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
    for (const v of verdicts) tally.set(v, (tally.get(v) ?? 0) + 1);

    // A run that never returned a verdict is the HARNESS being broken, not the lens
    // being wrong — the same line `core/llm/verdict.ts` draws and the gate must keep.
    // Reporting them as one number hides which of the two problems you actually have.
    const decided = verdicts.filter((v) => !v.startsWith("ERROR:"));
    const errors = verdicts.length - decided.length;
    const correct = verdicts.filter((v) => v === fixture.expect).length;
    const flipped = new Set(decided).size > 1;
    const unanimous = tally.size === 1;
    const spread = [...tally.entries()].map(([v, n]) => `${v}×${n}`).join(", ");
    outcomes.push({
      fixture, correct, errors, flipped, unanimous, spread,
      verdicts: verdicts.map((v) => (v === "pass" ? "pass" : v === "fail" ? "fail" : "errored")),
    });

    const mark = correct === RUNS ? "ok  " : "MISS";
    const why = flipped ? "FLIPPED  " : errors > 0 ? `err×${errors}   `.slice(0, 9) : "unanimous";
    console.log(
      `  ${mark} ${fixture.file.padEnd(nameWidth)}  ${fixture.difficulty.padEnd(6)} ` +
        `expect=${fixture.expect.padEnd(4)} correct=${String(correct).padStart(2)}/${RUNS}  ` +
        `${why}  [${spread}]`,
    );
  }

  // THE PASS RULE IS UNCHANGED from the first run: correct AND unanimous on EVERY
  // fixture, zero flips. An infrastructure error still costs the fixture its pass —
  // a lens that cannot return a verdict cannot gate either — but it is reported
  // separately below so the two failure modes are never read as one.
  const failed = outcomes.filter((o) => o.correct !== RUNS);
  const flips = outcomes.filter((o) => o.flipped);
  const broken = outcomes.filter((o) => o.errors > 0);

  if (failed.length > 0) {
    console.log("\n  where it went wrong — ground truth for each miss:");
    for (const o of failed) console.log(`    ${o.fixture.file}: ${o.fixture.truth}`);
  }

  const byDifficulty = new Map<string, { total: number; clean: number }>();
  for (const o of outcomes) {
    const d = byDifficulty.get(o.fixture.difficulty) ?? { total: 0, clean: 0 };
    d.total += 1;
    if (o.correct === RUNS) d.clean += 1;
    byDifficulty.set(o.fixture.difficulty, d);
  }
  const breakdown = ["easy", "medium", "hard"]
    .filter((d) => byDifficulty.has(d))
    .map((d) => `${d} ${byDifficulty.get(d)!.clean}/${byDifficulty.get(d)!.total}`)
    .join(" · ");

  const totalRuns = outcomes.length * RUNS;
  const totalErrors = outcomes.reduce((n, o) => n + o.errors, 0);

  console.log(`\n  clean    ${outcomes.length - failed.length}/${outcomes.length} fixtures  (${breakdown})`);

  // By DEFECT SHAPE, not only by difficulty. The v4 run printed
  // `hard 5/6` — true, and it took reading the fixture NAME to learn that the
  // single miss was `race-good`, i.e. that the lens invents races in correct
  // concurrent code. That is the difference between one fixture's phrasing and a
  // systematic blind spot, and it decides whether the prompt or the approach is
  // what needs changing.
  const slices = slicesOf(
    outcomes.map((o) => ({
      file: o.fixture.file,
      expected: o.fixture.expect,
      clean: o.correct === RUNS,
    })),
  );
  if (slices.length > 1) {
    console.log("\n  by defect, worst first:");
    for (const line of renderSlices(slices)) console.log(`  ${line}`);
  }
  console.log(
    `  judgment ${flips.length} fixture(s) flipped` +
      (flips.length > 0 ? `: ${flips.map((o) => o.fixture.file).join(", ")}` : ""),
  );
  console.log(
    `  harness  ${totalErrors}/${totalRuns} runs returned no verdict` +
      (broken.length > 0 ? ` (${broken.map((o) => o.fixture.file).join(", ")})` : ""),
  );
  console.log(`  cost     $${totalCost.toFixed(4)}`);
  // A --filter run measures a SUBSET, so it can never authorise a promotion. Printing
  // the same "PASS — may be declared block" line after `--filter race` is how someone
  // promotes a lens on four runs of the two fixtures it happens to be good at. The
  // promotion verdict requires the whole fixture set.
  if (FILTER) {
    console.log(
      `\n  PARTIAL — filtered to "${FILTER}" (${fixtures.length} of the fixture set). ` +
        `\n  A filtered run diagnoses; it cannot promote. Run unfiltered to decide severity.`,
    );
    process.exitCode = failed.length === 0 ? 0 : 1;
    return;
  }

  // THE ARTIFACT. Prose used to be the only output, and a human then transcribed a
  // conclusion from it into a YAML field nothing checked — which is how an unmeasured
  // lens reached `block` (sig-0034). The receipt is what the loader reads; everything
  // above is for the person watching.
  const receipt = recordCalibration({
    checkId: CHECK_ID,
    lens: LENS,
    fixtures: await fixtureFiles(dir),
    model: MODEL,
    runtime: { name: "claude", version: version ?? "unknown" },
    results: outcomes.map((o) => ({
      fixture: o.fixture.file,
      expected: o.fixture.expect,
      got: [...o.verdicts],
    })),
    at: new Date(),
  });
  const receiptPath = join(definitionRoot(repoRoot), "checks", receiptName(CHECK_ID));
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  console.log(
    `\n  wrote ${DEFINITION_DIR}/checks/${receiptName(CHECK_ID)} — verdict: ${receipt.verdict}`,
  );

  console.log(
    receipt.verdict === "passed"
      ? "  PASS — this lens may now be declared `severity: block`."
      : "  FAIL — this lens is capped at `warn`/`annotate` (ADR-0008).",
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
