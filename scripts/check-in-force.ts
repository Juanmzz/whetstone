/**
 * A decision that says it is not in force must say so where a machine can read it.
 *
 * `accepted` records what was decided, never whether anything implements it. adr-0006
 * read `accepted` for six weeks while nothing merged, and the only place that was
 * written down was a paragraph and a hand-maintained line in AGENTS.md.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDecisions } from "../src/core/decisions/anchors.js";
import { DEFINITION_DIR } from "../src/core/paths.js";

const PAGE = join(DEFINITION_DIR, "memory", "decisions.md");

/** `proposed` already says it is not in force; the marker would be noise there. */
const CLAIMS_PARTIAL = /\b(not|half) in force\b/i;

async function main(): Promise<void> {
  const { entries } = parseDecisions(await readFile(PAGE, "utf-8"));

  const drifted = entries.filter(
    (e) => e.status === "accepted" && CLAIMS_PARTIAL.test(e.body) && !e.unbuilt,
  );
  const unbuilt = entries.filter((e) => e.unbuilt);

  if (drifted.length > 0) {
    console.error(`${PAGE}: a decision says it is not in force and the meta line does not.\n`);
    for (const e of drifted) {
      console.error(`  ${e.id} (line ${String(e.line)}) — ${e.title}`);
    }
    console.error(`\nAdd \` · unbuilt\` after the date, so this is a fact and not a paragraph.`);
    process.exit(1);
  }

  if (unbuilt.length === 0) {
    console.error(`${PAGE}: every accepted decision claims to be in force`);
    return;
  }

  console.error(`decided and not yet true of the code:\n`);
  for (const e of unbuilt) console.error(`  ${e.id} · ${e.status} · ${e.title}`);
}

await main();
