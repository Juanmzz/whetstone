/**
 * Two documents may not disagree about one relationship.
 *
 * Whetstone's central claim about itself is that every rule here was earned by
 * something that went wrong. The evidence for that claim is a set of edges spread
 * across four kinds of file — a signal names the rule it implicates, a rule names
 * the signals that earned it, a check names the decision it rests on. Nothing ever
 * read two of them together, so nothing noticed when they stopped agreeing.
 *
 * They had. This check's first run found both cases it was written for.
 *
 * Reading is `core/graph/edges.ts` — pure, derived, nothing stored. This script is
 * the I/O around it.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { contradictionsIn, edgesOf, type Corpus } from "../src/core/graph/edges.js";
import { DEFINITION_DIR } from "../src/core/paths.js";

const ROOT = join(import.meta.dirname, "..");
const at = (...parts: string[]): string => join(ROOT, DEFINITION_DIR, ...parts);

async function textsIn(dir: string, prefix: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out; // a repo without that directory yet
  }
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    out[`${prefix}/${name}`] = await readFile(join(dir, name), "utf-8");
  }
  return out;
}

async function main(): Promise<void> {
  const corpus: Corpus = {
    signals: await readFile(at("memory", "signals.jsonl"), "utf-8"),
    skills: await textsIn(at("skills"), "skills"),
    checks: await textsIn(at("checks"), "checks"),
    decisions: await readFile(at("memory", "decisions.md"), "utf-8"),
  };

  const edges = edgesOf(corpus);
  if (edges.length === 0) {
    // Reported, not passed: a check that was selected and examined nothing is the
    // same "verified nothing" the gate refuses to dress up as a pass.
    console.error("no provenance edges found: nothing was verified");
    process.exit(1);
  }

  const problems = contradictionsIn(corpus);
  if (problems.length > 0) {
    for (const p of problems) console.error(`${p.path}  ${p.detail}`);
    console.error(`\n${String(problems.length)} contradiction(s) across ${String(edges.length)} edges`);
    process.exit(1);
  }

  const byKind = edges.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byKind)
    .map(([kind, n]) => `${String(n)} ${kind}`)
    .join(" · ");
  console.error(`${String(edges.length)} provenance edges agree: ${summary}`);
}

await main();
