/**
 * Every decision id cited anywhere in the repo resolves to an anchor in
 * `.wst/memory/decisions.md`. Deterministic, no model, no network.
 *
 * Ids are load-bearing references, not decoration: a check's `origin:` names them,
 * comments cite them to say why code is shaped the way it is, and prose points at
 * them everywhere. The nineteen per-file ADRs were folded into one page (adr-0019),
 * which turned "the file exists" into "the anchor exists" — a citation that no longer
 * resolves reads exactly like one that does, and fails silently.
 *
 * This replaces `check-adrs.ts`, which validated per-file frontmatter and sections.
 * One thing from that shape survives the fold: every entry carries a `status`,
 * because that is how a decision is amended and it is what a retro flips. Reading
 * the page is `core/decisions/anchors.ts`, shared with `check-docs-fresh.ts`; this
 * script is the I/O around it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: judge the prose. Whether an entry states the
 * rejected alternative well is a reader's call and a retro's; whether `adr-0011`
 * resolves is a fact.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseDecisions } from "../src/core/decisions/anchors.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { gitEnv } from "../src/shell/git.js";

const run = promisify(execFile);

const ROOT = join(import.meta.dirname, "..");
const PAGE = join(DEFINITION_DIR, "memory", "decisions.md");

/**
 * Where a citation can live. `.jsonl` is here for the signal log, whose lines cite
 * decisions like any other prose; the second branch is for `.githooks/`, whose
 * scripts carry no extension at all.
 */
const READABLE = /(\.(md|ts|mjs|js|json|jsonl|ya?ml)|^\.githooks\/[^/.]+)$/;

const CITATION = /adr-(\d{4})/gi;

/**
 * The two ways a reference names a decision FILE rather than a decision: a markdown
 * link into the directory this page replaced, and the wiki-link form the skills use
 * (`[[NNNN-slug]]`). Both resolve to nothing now, and neither is
 * an `adr-NNNN` citation, so the count above cannot see them.
 */
const DEAD_LINK = [
  /\]\([^)]*memory\/decisions\/\d{4}[^)]*\)/,
  /\[\[\d{4}-[a-z0-9-]+\]\]/,
];

/**
 * The id `init` writes into a target repo's ADR template. It is a placeholder for a
 * decision that repo has not made yet, not a citation of one of ours.
 */
const PLACEHOLDER = new Set(["adr-0000"]);

interface Problem {
  readonly where: string;
  readonly why: string;
}

/**
 * Every tracked file a citation could live in.
 *
 * `git ls-files` rather than a directory walk, and the difference is not style.
 * A walk needs a hand-maintained list of roots to visit and names to skip, and
 * that list was wrong in both directions at once: it missed `.github/` and
 * `.githooks/` — `gate.yml` cites adr-0009 — while sweeping in `.claude/worktrees/`,
 * where a leased worktree holds a whole second checkout of this repo at whatever
 * commit it was cut from. A stale copy's citations are not this branch's problem,
 * and `.wst/receipts/` and `.wst/events.jsonl` are per-machine runtime state.
 *
 * Tracked-ness answers all of it: what travels is what git holds. It is also what
 * the gate triages, so the set this scans and the set that triggers it agree.
 */
async function trackedFiles(): Promise<string[]> {
  const { stdout } = await run("git", ["ls-files", "-z"], {
    cwd: ROOT,
    env: gitEnv(),
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split("\0").filter((path) => path !== "" && READABLE.test(path));
}

async function main(): Promise<void> {
  let page: string;
  try {
    page = await readFile(join(ROOT, PAGE), "utf-8");
  } catch (cause) {
    console.error(`cannot read ${PAGE}: ${(cause as Error).message}`);
    process.exit(1);
  }

  const parsed = parseDecisions(page);
  const problems: Problem[] = parsed.problems.map((p) => ({ where: `${PAGE}:${p.line}`, why: p.why }));
  if (parsed.entries.length === 0) {
    // Reported, not passed. An empty result from a check that was selected is the
    // same "verified nothing" the gate refuses to dress up as a pass.
    console.error(`${PAGE} holds no \`### adr-NNNN\` anchors — nothing was verified`);
    process.exit(1);
  }
  const known = new Set(parsed.entries.map((e) => e.id));

  const scanned = await trackedFiles();

  let citations = 0;
  for (const rel of scanned) {
    const text = await readFile(join(ROOT, rel), "utf-8");
    text.split("\n").forEach((line, index) => {
      const at = `${rel}:${index + 1}`;
      for (const hit of line.matchAll(CITATION)) {
        const id = hit[0].toLowerCase();
        if (PLACEHOLDER.has(id)) continue;
        citations += 1;
        if (!known.has(id)) problems.push({ where: at, why: `cites ${id}, which has no anchor in ${PAGE}` });
      }
      if (DEAD_LINK.some((dead) => dead.test(line))) {
        problems.push({ where: at, why: `names a decision FILE, which no longer exists — cite the id, or link \`${PAGE}#adr-NNNN\`` });
      }
    });
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`${p.where} ${p.why}`);
    console.error(`\n${problems.length} problem(s) across ${scanned.length} files`);
    process.exit(1);
  }

  console.error(`${citations} citations across ${scanned.length} files: every id resolves to one of ${parsed.entries.length} anchors`);
}

await main();
