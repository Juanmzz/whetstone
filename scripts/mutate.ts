/**
 * Mutation harness. Answers two different questions that get conflated:
 *
 *   1. Do the tests CATCH bugs?      -> mutation score (survivors are gaps)
 *   2. Are there TOO MANY tests?     -> how many tests die per mutation, and which
 *                                       tests never die at all
 *
 * (2) is the one worth measuring here. A test that fails for no mutation anywhere
 * is not protecting anything: it either restates a type the compiler already
 * enforces, or asserts a detail no plausible defect changes. That is the honest
 * definition of a redundant test, as opposed to "it feels like a lot".
 *
 *   npm run mutate -- --path src/core/gate [--limit 40]
 *
 * Deliberately dependency-free and deliberately crude: operator swaps only. It is
 * a measurement instrument, not a product surface, so it lives in scripts/ at light
 * tier. Mutations that fail to compile are reported as INVALID, never as killed:
 * counting a syntax error as a caught bug would inflate the score exactly where the
 * instrument is weakest.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

interface Mutation {
  readonly file: string;
  readonly line: number;
  readonly from: string;
  readonly to: string;
  readonly snippet: string;
}

/** Ordered: earlier patterns are likelier to change behaviour meaningfully. */
const OPERATORS: readonly (readonly [RegExp, string])[] = [
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ >= /g, " > "],
  [/ <= /g, " < "],
  [/ && /g, " || "],
  [/\.length === 0/g, ".length !== 0"],
  [/return true;/g, "return false;"],
  [/return false;/g, "return true;"],
];

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

/** `root` is a path prefix, e.g. `src/core/gate`. */
async function sourceFiles(root: string): Promise<string[]> {
  const { stdout } = await exec("sh", ["-c", `fd -e ts -E '*.test.ts' . '${root}' | sort`]);
  return stdout.trim().split("\n").filter(Boolean);
}

function mutationsFor(file: string, text: string): Mutation[] {
  const out: Mutation[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments are not behaviour
    for (const [pattern, to] of OPERATORS) {
      if (new RegExp(pattern.source).test(line)) {
        out.push({
          file,
          line: i + 1,
          from: pattern.source,
          to,
          snippet: line.trim().slice(0, 70),
        });
      }
    }
  });
  return out;
}

/** Which test NAMES failed. Vitest exits non-zero and lists them on stdout. */
async function failingTests(): Promise<{ ran: boolean; failed: Set<string> }> {
  try {
    await exec("npx", ["vitest", "run", "--reporter=dot"], { maxBuffer: 64 * 1024 * 1024 });
    return { ran: true, failed: new Set() };
  } catch (cause) {
    const out = `${(cause as { stdout?: string }).stdout ?? ""}${(cause as { stderr?: string }).stderr ?? ""}`;
    // A crash before any test ran is NOT a killed mutation.
    if (!/Test Files|Tests /.test(out)) return { ran: false, failed: new Set() };
    const failed = new Set<string>();
    for (const m of out.matchAll(/^\s*(?:FAIL|×)\s+(.+?)(?:\s+\d+ms)?$/gm)) {
      if (m[1] !== undefined) failed.add(m[1].trim());
    }
    return { ran: true, failed };
  }
}

async function main() {
  const root = arg("--path", "src/core");
  const limit = Number(arg("--limit", "30"));

  const files = await sourceFiles(root);
  const all = (
    await Promise.all(
      files.map(async (f) => mutationsFor(f, await readFile(f, "utf-8"))),
    )
  ).flat();

  // Spread across files rather than exhausting the first one.
  const sampled: Mutation[] = [];
  const perFile = new Map<string, number>();
  for (const m of all) {
    const n = perFile.get(m.file) ?? 0;
    if (n < Math.ceil(limit / Math.max(files.length, 1)) + 1) {
      sampled.push(m);
      perFile.set(m.file, n + 1);
    }
    if (sampled.length >= limit) break;
  }

  console.log(`mutating ${files.length} file(s): ${sampled.length} of ${all.length} candidates\n`);

  let killed = 0;
  let survived = 0;
  let invalid = 0;
  const killCounts: number[] = [];
  const everFailed = new Set<string>();
  const survivors: Mutation[] = [];

  for (const [i, m] of sampled.entries()) {
    const original = await readFile(m.file, "utf-8");
    const lines = original.split("\n");
    const target = lines[m.line - 1] ?? "";
    lines[m.line - 1] = target.replace(new RegExp(m.from), m.to);
    await writeFile(m.file, lines.join("\n"), "utf-8");

    const { ran, failed } = await failingTests();
    await writeFile(m.file, original, "utf-8"); // ALWAYS restore

    const tag = !ran ? "INVALID" : failed.size > 0 ? `killed x${failed.size}` : "SURVIVED";
    if (!ran) invalid++;
    else if (failed.size > 0) {
      killed++;
      killCounts.push(failed.size);
      for (const t of failed) everFailed.add(t);
    } else {
      survived++;
      survivors.push(m);
    }
    console.log(
      `  [${String(i + 1).padStart(3)}/${sampled.length}] ${tag.padEnd(12)} ${m.file.replace("src/", "")}:${m.line}  ${m.snippet}`,
    );
  }

  const scored = killed + survived;
  const avgKills = killCounts.length > 0 ? killCounts.reduce((a, b) => a + b, 0) / killCounts.length : 0;

  console.log(`\n  mutation score   ${killed}/${scored} killed (${invalid} invalid, not counted)`);
  console.log(`  redundancy       ${avgKills.toFixed(1)} tests fail per killed mutation (1.0 = no overlap)`);
  console.log(`  distinct tests   ${everFailed.size} ever failed`);

  if (survivors.length > 0) {
    console.log(`\n  SURVIVORS (a real bug here would ship):`);
    for (const s of survivors) console.log(`    ${s.file.replace("src/", "")}:${s.line}  ${s.snippet}`);
  }
}

await main();
