/**
 * The adapter for `core/history/untested.ts`: turns git into the data that module
 * takes, and prints what it returns.
 *
 * A TOOL, deliberately not a check. It is not in `.wst/checks/` and the gate does
 * not run it. Non-negotiable 4 says a check cites the signals that earned it, and
 * nothing has earned this one — the numbers below were measured out of git rather
 * than accumulated from friction. When the gap it reports causes real trouble,
 * `wst signal` records that, the retro clusters it, and THEN it can enter the
 * registry with an origin it actually has. Shortcutting that is the loop this
 * project exists to demonstrate, skipped.
 *
 *   npm run untested
 *   npm run untested -- --range origin/main..HEAD
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseNameStatus, type ChangedFile } from "../src/core/diff/parse.js";
import {
  findUntestedArrivals,
  isTestPath,
  moduleKey,
  type HistoryCommit,
} from "../src/core/history/untested.js";
import { DEFINITION_DIR } from "../src/core/paths.js";
import { classify } from "../src/core/triage/classify.js";
import { loadTriageRules } from "../src/shell/sdd.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { maxBuffer: MAX_BUFFER });
  return stdout;
}

/** `git` that returns null instead of throwing — for the "does this ref exist" questions. */
async function gitOrNull(...args: string[]): Promise<string | null> {
  try {
    return await git(...args);
  } catch {
    return null;
  }
}

/**
 * The range to measure. Defaults to the branch: everything since it left the
 * trunk. On the trunk itself there is no such point, and measuring all of history
 * would reprint every hole ever opened, so a window keeps it about recent work.
 */
const WINDOW = 40;

async function resolveRange(argv: readonly string[]): Promise<{ base: string | null; spec: string[] }> {
  const flag = argv.indexOf("--range");
  const explicit = flag === -1 ? process.env["WST_UNTESTED_RANGE"] : argv[flag + 1];
  if (explicit !== undefined && explicit !== "") {
    const base = explicit.includes("..") ? (explicit.split("..")[0] ?? null) : null;
    return { base, spec: [explicit] };
  }

  for (const trunk of ["refs/remotes/origin/HEAD", "origin/main"]) {
    const base = (await gitOrNull("merge-base", "HEAD", trunk))?.trim();
    if (base !== undefined && base !== "") {
      const ahead = (await gitOrNull("rev-list", "--count", `${base}..HEAD`))?.trim();
      if (ahead !== undefined && ahead !== "0") return { base, spec: [`${base}..HEAD`] };
    }
  }

  const total = Number.parseInt(((await gitOrNull("rev-list", "--count", "HEAD")) ?? "0").trim(), 10);
  if (total <= WINDOW) return { base: null, spec: ["HEAD"] };
  const base = (await git("rev-parse", `HEAD~${WINDOW}`)).trim();
  return { base, spec: [`${base}..HEAD`] };
}

/** Commits oldest-first, each with the files it touched. */
async function readCommits(spec: readonly string[]): Promise<HistoryCommit[]> {
  // RS opens a commit, US separates sha from subject. Neither can appear in a
  // subject, so the stream stays parseable however the message is written.
  // Written as git's own `%x1e`/`%x1f` escapes rather than literal bytes: node
  // refuses to spawn a process whose argv contains a NUL.
  const raw = await git(
    "log",
    "--reverse",
    "--no-merges",
    "--format=%x1e%H%x1f%s",
    "--name-status",
    ...spec,
  );

  const commits: HistoryCommit[] = [];
  for (const block of raw.split("\x1e")) {
    if (block.trim() === "") continue;
    const newline = block.indexOf("\n");
    const header = newline === -1 ? block : block.slice(0, newline);
    const [sha, subject] = header.split("\x1f");
    if (sha === undefined || subject === undefined) continue;
    const body = newline === -1 ? "" : block.slice(newline + 1);
    commits.push({ sha, subject, files: parseNameStatus(body) });
  }
  return commits;
}

/** Modules already carrying a test at `base`. Empty when the range has no base. */
async function testedAtBase(base: string | null): Promise<string[]> {
  if (base === null) return [];
  const raw = (await gitOrNull("ls-tree", "-r", "--name-only", base)) ?? "";
  return raw
    .split("\n")
    .filter((path) => path !== "" && isTestPath(path))
    .map(moduleKey);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = (await git("rev-parse", "--show-toplevel")).trim();
  const { rules, origin } = await loadTriageRules(join(repoRoot, DEFINITION_DIR));

  // Triage owns what "strict" means; re-encoding the globs here would cost a
  // silent disagreement the first time triage.yaml changed. The `.ts` filter is
  // this script's, because triage cannot express "could have a colocated test".
  const inScope = (path: string): boolean => {
    if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
    const file: ChangedFile = { path, status: "modified" };
    return classify([file], rules, origin).tier === "strict";
  };

  const { base, spec } = await resolveRange(argv);
  const commits = await readCommits(spec);
  const found = findUntestedArrivals(commits, {
    inScope,
    testedAtBase: await testedAtBase(base),
  });

  const scanned = `${commits.length} commit${commits.length === 1 ? "" : "s"} (${spec.join(" ")})`;
  if (found.length === 0) {
    console.log(`untested: ${scanned} — every strict module that arrived brought a test.`);
    return;
  }

  console.log(`untested: ${found.length} strict module(s) arrived with no test, over ${scanned}.\n`);
  for (const a of found) {
    console.log(`  ${a.sha.slice(0, 8)}  ${a.file}`);
    console.log(`            ${a.subject}`);
  }
  console.log(
    `\n${DEFINITION_DIR}/triage-rules.md puts src/core/** at strict. These arrived uncovered.`,
  );
  console.log("This is a report, not a gate: nothing blocks on it.");
}

await main();
