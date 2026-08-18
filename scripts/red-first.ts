/**
 * The adapter for `core/history/red-first.ts`: turns git into the data that
 * module takes, and prints what it returns.
 *
 * Thin on purpose. Every decision — what counts as a module, what counts as
 * preceding, which violations are which — lives in the core, where it is unit
 * tested without a repository. What is here is the part that cannot be: reading
 * commits, resolving a range, and asking triage which paths are strict.
 *
 * Run by the `red-first` check. Also runnable by hand:
 *   npm run red-first -- --range origin/main..HEAD
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseNameStatus, type ChangedFile } from "../src/core/diff/parse.js";
import {
  findRedFirstViolations,
  isTestPath,
  moduleKey,
  type HistoryCommit,
} from "../src/core/history/red-first.js";
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
 * The range to measure.
 *
 * A deterministic check is spawned as a bare command with no arguments — the gate
 * does not pass its `--range` down — so this has to answer the question itself.
 * The default is the branch: everything since it left the trunk, which is the same
 * span the pre-push hook gates. On the trunk itself there is no such point, and
 * measuring all of history would report every violation ever committed on every
 * run. A window keeps the check about the work in front of you.
 */
const WINDOW = 40;

async function resolveRange(argv: readonly string[]): Promise<{ base: string | null; spec: string[] }> {
  const flag = argv.indexOf("--range");
  const explicit = flag === -1 ? process.env["WST_RED_FIRST_RANGE"] : argv[flag + 1];
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
  // subject, so the stream stays parseable however the message is written. Written
  // as git's own `%x1e`/`%x1f` escapes rather than as literal bytes: node refuses
  // to spawn a process whose argv contains a NUL, and the escapes keep the choice
  // of separator free of that constraint.
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

  // Triage stays the one owner of what "strict" means. Asking it per path costs a
  // classify() call each; re-encoding the globs here would cost a silent
  // disagreement the first time triage.yaml changes.
  //
  // The second half of the filter is this script's, because triage cannot express
  // it: `.claude/hooks/**` and the skills are strict and are not TypeScript
  // modules, so there is no colocated test they could ever have. Declaration files
  // are excluded for the same reason — `.d.ts` emits no behaviour.
  const inScope = (path: string): boolean => {
    if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
    const file: ChangedFile = { path, status: "modified" };
    return classify([file], rules, origin).tier === "strict";
  };

  const { base, spec } = await resolveRange(argv);
  const commits = await readCommits(spec);
  const violations = findRedFirstViolations(commits, {
    inScope,
    testedAtBase: await testedAtBase(base),
  });

  const scanned = `${commits.length} commit${commits.length === 1 ? "" : "s"} (${spec.join(" ")})`;
  if (violations.length === 0) {
    console.log(`red-first: ${scanned} — every strict-tier change had its test first.`);
    return;
  }

  console.log(`red-first: ${violations.length} of ${scanned} arrived with no test.\n`);
  for (const v of violations) {
    const why = "no commit has touched this module's test";
    console.log(`  ${v.sha.slice(0, 8)}  ${v.file}`);
    console.log(`            ${why}`);
    console.log(`            ${v.subject}`);
  }
  console.log(
    `\nHard rule 4: ${DEFINITION_DIR}/triage-rules.md puts src/core/** at strict — RED first, in its own commit.`,
  );
  console.log("This check warns; it does not block. See the check file for why.");

  // Non-zero is how the gate learns the check failed. Severity `warn` is what
  // stops that from blocking a push — the exit code states the finding, the
  // registry decides what it costs.
  process.exitCode = 1;
}

await main();
