/**
 * Verify the SHAPE of every ADR. Deterministic, no model, no network.
 *
 * Why this exists, and it is not really about ADRs. Until now this repo had three
 * checks — `test`, `typecheck`, `correctness` — and all three match `.ts` files
 * only. So a change touching nothing but markdown selected no check, and
 * `exitCodeFor` correctly refused to call that a pass: "a run that verified NOTHING
 * is not a pass". The consequence went unnoticed because no documentation-only PR
 * had ever been attempted — the last docs commit rode into `main` inside a PR that
 * also carried code. The first pure-docs branch could not be pushed at all.
 *
 * The honest fix is not to loosen the exit code. It is to make a document
 * verifiable, which is what this does.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: check that paths cited inside an ADR still
 * exist. That was the first design and it is wrong. ADR-0007 forbids rewriting
 * accepted prose, and ADR-0009 records the deletion of `commands/pr.ts`,
 * `core/annotate/` and `shell/github.ts` — an ADR is a historical record, and
 * citing a file that has since been deleted is the record being accurate, not
 * stale. A check that flagged it would demand the one edit the constitution
 * forbids.
 *
 * So: shape only. Frontmatter that parses, a status inside the enum, an id that
 * agrees with the filename, and the three sections the template requires. Every
 * one of those is a fact about the file itself, which is why this can block with no
 * calibration and no false positives.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { DEFINITION_DIR } from "../src/core/paths.js";

// Derived, never spelled. ADR-0012 renamed this directory once already, and
// `test/definition-dir.test.ts` enforces that no value under `src/` or `scripts/`
// hardcodes the name — which is how the rename stayed a one-line change.
const DECISIONS = join(DEFINITION_DIR, "memory", "decisions");
const STATUSES = ["proposed", "accepted", "superseded"];
const SECTIONS = ["## Context", "## Decision", "## Consequences"];

/** `_TEMPLATE.md` is the shape, not an instance of it. */
const isAdrFile = (name: string): boolean => name.endsWith(".md") && !name.startsWith("_");

interface Problem {
  readonly file: string;
  readonly why: string;
}

function frontmatterOf(text: string): { data: unknown; body: string } | null {
  // `---\n ... \n---\n`, and only at the very start. A fenced block later in the
  // document is prose, not metadata.
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (match === null) return null;
  try {
    return { data: parse(match[1] ?? ""), body: match[2] ?? "" };
  } catch {
    return null;
  }
}

function checkOne(file: string, text: string, known: ReadonlySet<string>): Problem[] {
  const out: Problem[] = [];
  const push = (why: string): number => out.push({ file, why });

  const parsed = frontmatterOf(text);
  if (parsed === null) {
    // Nothing else can be said about a file whose metadata will not parse, and
    // guessing past it would report a pile of consequential noise.
    return [{ file, why: "has no parseable YAML frontmatter delimited by `---`" }];
  }

  const { data, body } = parsed;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [{ file, why: "has frontmatter that is not a mapping" }];
  }
  const fm = data as Record<string, unknown>;

  const id = fm["id"];
  if (typeof id !== "string" || !/^adr-\d{4}$/.test(id)) {
    push(`has id ${JSON.stringify(id)}, expected \`adr-NNNN\``);
  } else {
    // The filename is how a human finds the file and the id is how every other
    // document cites it. When they disagree, one of the two references is dead and
    // there is no way to tell which from the outside.
    const prefix = file.slice(0, 4);
    if (id.slice(4) !== prefix) {
      push(`is named \`${file}\` but declares id \`${id}\``);
    }
  }

  if (typeof fm["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fm["ts"])) {
    push(`has ts ${JSON.stringify(fm["ts"])}, expected \`YYYY-MM-DD\``);
  }

  const status = fm["status"];
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    // The one field with teeth: `wst retro` flips a status to amend a decision
    // (ADR-0007), so a status outside the enum is a decision no reader and no tool
    // can classify.
    push(`has status ${JSON.stringify(status)}, expected one of ${STATUSES.join("/")}`);
  }

  const supersedes = fm["supersedes"];
  if (supersedes !== null && supersedes !== undefined) {
    if (typeof supersedes !== "string" || !known.has(supersedes)) {
      push(`supersedes ${JSON.stringify(supersedes)}, which is not an ADR in this directory`);
    }
  }

  if (!Array.isArray(fm["rules_affected"])) {
    push("has no `rules_affected` array (use `[]` when a decision changes no skill)");
  }

  if (!/^#\s+\S/m.test(body)) {
    push("has no `# ` title");
  }
  for (const section of SECTIONS) {
    if (!body.includes(`\n${section}`) && !body.startsWith(section)) {
      push(`is missing the \`${section}\` section`);
    }
  }

  return out;
}

async function main(): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(DECISIONS)).filter(isAdrFile).sort();
  } catch (cause) {
    console.error(`cannot read ${DECISIONS}: ${(cause as Error).message}`);
    process.exit(1);
  }

  if (names.length === 0) {
    // Reported, not passed. An empty result from a check that was selected is the
    // same "verified nothing" the gate refuses to dress up as a pass.
    console.error(`${DECISIONS} holds no ADRs — nothing was verified`);
    process.exit(1);
  }

  const texts = await Promise.all(
    names.map(async (name) => [name, await readFile(join(DECISIONS, name), "utf-8")] as const),
  );
  // Built from the filenames rather than from the ids, so a file with a broken id
  // cannot vouch for a `supersedes` pointing at it.
  const known = new Set(names.map((name) => `adr-${name.slice(0, 4)}`));

  const problems = texts.flatMap(([name, text]) => checkOne(name, text, known));

  if (problems.length > 0) {
    for (const p of problems) console.error(`${DECISIONS}/${p.file} ${p.why}`);
    console.error(`\n${problems.length} problem(s) across ${names.length} ADR(s)`);
    process.exit(1);
  }

  console.log(`${names.length} ADRs: frontmatter, ids and sections all well-formed`);
}

await main();
