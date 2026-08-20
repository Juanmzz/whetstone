/**
 * The status block in `AGENTS.md` must match what the repo actually holds.
 *
 * That file carries a warning saying it has gone stale four times, describes the
 * drift as structural rather than careless, and then went stale a fifth time — it
 * claimed 581 tests and branch `engine-skeleton` while `main` had 884 and eight more
 * ADRs. A warning about staleness is not a defence against it. A check is.
 *
 * WHAT IS COUNTED, and why these three. Each is a cheap file operation with one
 * right answer: decision anchors on the page, lines in the signal log, commands the
 * CLI registers. The ADR count used to be files in a directory; adr-0019 folded them
 * into `decisions.md`, so the same claim is now a count of entries — read with
 * `core/decisions/anchors.ts`, the same parser `check-adr-refs.ts` uses to resolve
 * citations. Two regexes over one page is how the two counts drift apart.
 * The TEST COUNT is deliberately absent from the block — verifying it means running
 * the suite a second time inside a gate that already runs it, and it is the number
 * that changes most and informs least.
 *
 * A claim nobody can check is not documentation, it is decoration. This check exists
 * so the block stays the first kind.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDecisions } from "../src/core/decisions/anchors.js";
import { DEFINITION_DIR } from "../src/core/paths.js";

const AGENTS = "AGENTS.md";
const DECISIONS = join(DEFINITION_DIR, "memory", "decisions.md");
const SIGNALS = join(DEFINITION_DIR, "memory", "signals.jsonl");
const CLI = join("src", "cli.ts");

/** `## Status — branch `x` · N ADRs · N signals · N commands` */
const STATUS = /^## Status\b.*$/m;

interface Claim {
  readonly label: string;
  /** The pattern naming this count in the status line, used to read it and to rewrite it. */
  readonly unit: string;
  readonly claimed: number | null;
  readonly actual: number;
}

/**
 * The status line with every located count replaced by the real one.
 *
 * Only the digits move. Preserving the surrounding text is what lets the branch
 * name, the separators and the singular/plural spelling survive a fix.
 */
const rewrite = (line: string, claims: readonly Claim[]): string =>
  claims.reduce(
    (acc, c) =>
      c.claimed === null
        ? acc
        : acc.replace(new RegExp(`\\d+(\\s+${c.unit}\\b)`), `${String(c.actual)}$1`),
    line,
  );

const claimOf = (line: string, unit: string): number | null => {
  const found = new RegExp(`(\\d+)\\s+${unit}\\b`).exec(line);
  return found === null ? null : Number(found[1]);
};

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  const agents = await readFile(AGENTS, "utf-8");
  const status = STATUS.exec(agents)?.[0];
  if (status === undefined) {
    console.error(`${AGENTS} has no \`## Status\` heading to check`);
    process.exit(1);
  }

  const adrs = parseDecisions(await readFile(DECISIONS, "utf-8")).entries.length;

  // Blank lines are not signals. The log tolerates them; a count must not.
  const signals = (await readFile(SIGNALS, "utf-8"))
    .split("\n")
    .filter((l) => l.trim() !== "").length;

  // Counted from the source rather than from `--help`, so this check needs no build
  // and cannot pass against a stale `dist/`.
  const commands = [...(await readFile(CLI, "utf-8")).matchAll(/\n\s*\.command\(/g)].length;

  const claims: Claim[] = [
    { label: "ADRs", unit: "ADRs?", claimed: claimOf(status, "ADRs?"), actual: adrs },
    { label: "signals", unit: "signals?", claimed: claimOf(status, "signals?"), actual: signals },
    { label: "commands", unit: "commands?", claimed: claimOf(status, "commands?"), actual: commands },
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

    // A count the line never names has no place to be written back to, so `--fix`
    // reports it and still fails rather than guessing where it belongs.
    if (fix && missing.length === 0) {
      const fixed = rewrite(status, claims);
      await writeFile(AGENTS, agents.replace(status, () => fixed), "utf-8");
      console.error(`\nfixed — ${AGENTS} now says ${adrs} ADRs, ${signals} signals, ${commands} commands`);
      return;
    }

    console.error(
      fix
        ? `\nCannot fix a count the status line does not name. Add it, then re-run.`
        : `\nUpdate the status line, or run \`npm run fix:docs\`.`,
    );
    process.exit(1);
  }

  console.error(`${AGENTS} status: ${adrs} ADRs, ${signals} signals, ${commands} commands — all match`);
}

await main();
