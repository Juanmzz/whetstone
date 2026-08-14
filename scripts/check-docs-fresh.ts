/**
 * The status block in `AGENTS.md` must match what the repo actually holds.
 *
 * That file carries a warning saying it has gone stale four times, describes the
 * drift as structural rather than careless, and then went stale a fifth time — it
 * claimed 581 tests and branch `engine-skeleton` while `main` had 884 and eight more
 * ADRs. A warning about staleness is not a defence against it. A check is.
 *
 * WHAT IS COUNTED, and why these three. Each is a cheap file operation with one
 * right answer: ADRs on disk, lines in the signal log, commands the CLI registers.
 * The TEST COUNT is deliberately absent from the block — verifying it means running
 * the suite a second time inside a gate that already runs it, and it is the number
 * that changes most and informs least.
 *
 * A claim nobody can check is not documentation, it is decoration. This check exists
 * so the block stays the first kind.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFINITION_DIR } from "../src/core/paths.js";

const AGENTS = "AGENTS.md";
const DECISIONS = join(DEFINITION_DIR, "memory", "decisions");
const SIGNALS = join(DEFINITION_DIR, "memory", "signals.jsonl");
const CLI = join("src", "cli.ts");

/** `## Status — branch `x` · N ADRs · N signals · N commands` */
const STATUS = /^## Status\b.*$/m;

interface Claim {
  readonly label: string;
  readonly claimed: number | null;
  readonly actual: number;
}

const claimOf = (line: string, unit: string): number | null => {
  const found = new RegExp(`(\\d+)\\s+${unit}\\b`).exec(line);
  return found === null ? null : Number(found[1]);
};

async function main(): Promise<void> {
  const agents = await readFile(AGENTS, "utf-8");
  const status = STATUS.exec(agents)?.[0];
  if (status === undefined) {
    console.error(`${AGENTS} has no \`## Status\` heading to check`);
    process.exit(1);
  }

  const adrs = (await readdir(DECISIONS)).filter(
    (n) => n.endsWith(".md") && !n.startsWith("_"),
  ).length;

  // Blank lines are not signals. The log tolerates them; a count must not.
  const signals = (await readFile(SIGNALS, "utf-8"))
    .split("\n")
    .filter((l) => l.trim() !== "").length;

  // Counted from the source rather than from `--help`, so this check needs no build
  // and cannot pass against a stale `dist/`.
  const commands = [...(await readFile(CLI, "utf-8")).matchAll(/\n\s*\.command\(/g)].length;

  const claims: Claim[] = [
    { label: "ADRs", claimed: claimOf(status, "ADRs?"), actual: adrs },
    { label: "signals", claimed: claimOf(status, "signals?"), actual: signals },
    { label: "commands", claimed: claimOf(status, "commands?"), actual: commands },
  ];

  const missing = claims.filter((c) => c.claimed === null);
  const wrong = claims.filter((c) => c.claimed !== null && c.claimed !== c.actual);

  if (missing.length > 0 || wrong.length > 0) {
    console.error(`${AGENTS} status line:\n  ${status}\n`);
    for (const c of missing) {
      console.error(`  claims no ${c.label} count — the repo has ${c.actual}`);
    }
    for (const c of wrong) {
      console.error(`  claims ${String(c.claimed)} ${c.label} — the repo has ${c.actual}`);
    }
    console.error(`\nUpdate the status line. Every number in it is one command away.`);
    process.exit(1);
  }

  console.error(`${AGENTS} status: ${adrs} ADRs, ${signals} signals, ${commands} commands — all match`);
}

await main();
