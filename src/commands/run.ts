/**
 * `wst check run <id>` — run a check whose logic Whetstone ships rather than
 * shells out for.
 *
 * It exists so a seeded check can name a command the target repo already has.
 * `npm run check:comments` names a script nobody wrote there (adr-0025), and the
 * binary that wrote the check file is the one thing it can count on being there.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { judgeCommits, type Commit } from "../core/checks/commit-message.js";
import {
  addedLines,
  addedLinesOfNewFile,
  commentLines,
  judgeDensity,
  removedCommentIn,
  MAX_PERCENT,
} from "../core/checks/comment-density.js";
import {
  evidenceDir,
  isMachineReadable,
  judgeEvidence,
  type FoundEvidence,
} from "../core/checks/evidence.js";
import { parseNameStatus } from "../core/diff/parse.js";
import { matchFiles } from "../core/gate/select.js";
import { loadRegistry, resolveDefinitionRoot } from "../shell/sdd.js";
import { gitEnv } from "../shell/git.js";

/** The ids `wst check run` answers to. One entry, one runner, no catalogue. */
const RUNNERS: Readonly<Record<string, (cwd: string) => Promise<number>>> = {
  "comment-density": commentDensity,
  "commit-message": commitMessage,
};

/** Every check id under it is an evidence requirement, and shares one runner. */
const EVIDENCE_PREFIX = "evidence";

const exec = promisify(execFile);

const EXIT_FAILED = 1;
const EXIT_UNKNOWN = 2;

const git = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await exec("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    env: gitEnv(),
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

/** Where the diff ENDS: the right side of a range, or the working tree. */
const endOf = (range: string): string | null => {
  const dots = range.lastIndexOf("..");
  if (dots < 0) return null;
  const right = range.slice(dots + 2);
  return right === "" ? "HEAD" : right;
};

async function commentDensity(cwd: string): Promise<number> {
  const range = process.env["WST_GATE_RANGE"] ?? "HEAD";
  const end = endOf(range);
  const diff = await git(["diff", "--unified=0", range, "--", "*.ts"], cwd);
  const touched = addedLines(diff);

  // A file git has not seen appears in no diff, so the check was blind to the
  // one place bloat is most likely. Only meaningful against the working tree.
  if (end === null) {
    const listed = await git(["ls-files", "--others", "--exclude-standard", "--", "*.ts"], cwd);
    for (const path of listed.split("\n").filter((p) => p !== "")) {
      const text = await readFile(join(cwd, path), "utf-8").catch(() => "");
      if (text !== "") touched.set(path, addedLinesOfNewFile(text));
    }
  }

  let comment = 0;
  let code = 0;
  for (const [path, lines] of touched) {
    if (lines.length === 0) continue;
    const text =
      end === null
        ? await readFile(join(cwd, path), "utf-8").catch(() => "")
        : await git(["show", `${end}:${path}`], cwd).catch(() => "");
    const commented = commentLines(text);
    const source = text.split("\n");
    for (const n of lines) {
      if ((source[n - 1] ?? "").trim() === "") continue;
      if (commented.has(n)) comment += 1;
      else code += 1;
    }
  }

  const removedComment = removedCommentIn(diff, (path) => (touched.get(path)?.length ?? 0) > 0);
  const verdict = judgeDensity({ comment, code, removedComment });

  switch (verdict.kind) {
    case "net-reduction":
      console.error(
        `comment density: ${String(verdict.added)} added, ${String(verdict.removed)} removed over ${range}: net reduction`,
      );
      return 0;
    case "too-few":
      console.error(`comment density: ${String(verdict.total)} added lines over ${range}: too few to judge`);
      return 0;
    case "under":
      console.error(
        `${String(verdict.percent)}% of ${String(verdict.total)} added .ts lines over ${range} are comment: under the ${String(MAX_PERCENT)}% ceiling`,
      );
      return 0;
    case "over":
      console.error(
        `${String(verdict.percent)}% of ${String(verdict.total)} added .ts lines over ${range} are comment, over the ${String(MAX_PERCENT)}% ceiling.\n`,
      );
      console.error(`Comments belong where the code cannot be made clear on its own.`);
      console.error(
        `History and rejected alternatives go in the pull request description, not above the code.`,
      );
      return EXIT_FAILED;
  }
}

/**
 * The commits a push is about to add, as records.
 *
 * NUL between the fields and a record separator between commits, because a body
 * holds newlines and a subject can hold anything. `--no-merges` because a merge
 * subject is written by git and by the forge, not by the person being checked.
 */
async function commitsIn(range: string, cwd: string): Promise<Commit[]> {
  const args = range.includes("..")
    ? ["log", "--no-merges", "--format=%H%x00%s%x00%b%x1e", range]
    : ["log", "--no-merges", "-1", "--format=%H%x00%s%x00%b%x1e", "HEAD"];

  const out = await git(args, cwd);
  return out
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha = "", subject = "", body = ""] = record.split("\x00");
      return { sha, subject, body };
    });
}

async function commitMessage(cwd: string): Promise<number> {
  const range = process.env["WST_GATE_RANGE"] ?? "HEAD";

  // A check that cannot READ the commits has not cleared them. Reporting 0 here
  // is the failure hard rule 3 exists to prevent.
  let commits: Commit[];
  try {
    commits = await commitsIn(range, cwd);
  } catch (cause) {
    console.error(`could not read the commits over ${range}: ${String(cause)}`);
    return EXIT_UNKNOWN;
  }

  const found = judgeCommits(commits);
  if (found.length === 0) {
    console.error(`${String(commits.length)} commit message(s) over ${range}: all conventional, none crediting a model.`);
    return 0;
  }

  console.error(`${String(found.length)} problem(s) in ${String(commits.length)} commit message(s) over ${range}:\n`);
  for (const f of found) console.error(`  ${f.sha.slice(0, 7)}  ${f.kind}\n    ${f.detail}\n`);
  console.error(`Amend the message. The rationale for a change goes in the pull request description.`);
  return EXIT_FAILED;
}

/**
 * Presence and freshness of the evidence one check requires (adr-0036).
 *
 * The store hangs off the COMMON git dir, so every linked worktree of a repo
 * shares one and the branch separates them. `.wst/` is read from this worktree,
 * because that is where the registry the gate loaded lives.
 */
async function evidence(checkId: string, cwd: string): Promise<number> {
  const worktree = (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
  const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)).trim();
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
  const dir = evidenceDir(dirname(common), branch, checkId);

  const check = (await loadRegistry(await resolveDefinitionRoot(worktree))).byId.get(checkId);
  if (check === undefined) {
    console.error(`no check "${checkId}" in the registry, so nothing says which paths owe it.`);
    return EXIT_UNKNOWN;
  }

  const range = process.env["WST_GATE_RANGE"] ?? "HEAD";
  const matched = matchFiles(check, parseNameStatus(await git(["diff", "--name-status", range], cwd)));
  let newestSourceMs: number | null = null;
  for (const file of matched) {
    const info = await stat(join(worktree, file.path)).catch(() => null);
    if (info !== null && (newestSourceMs === null || info.mtimeMs > newestSourceMs)) {
      newestSourceMs = info.mtimeMs;
    }
  }

  const found: FoundEvidence[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    found.push({
      name: entry.name,
      bytes: info.size,
      mtimeMs: info.mtimeMs,
      text: isMachineReadable(entry.name) ? await readFile(path, "utf-8").catch(() => "") : null,
    });
  }

  const verdict = judgeEvidence(found, newestSourceMs);
  switch (verdict.kind) {
    case "present":
      console.error(`${checkId}: ${String(verdict.count)} artifact(s) in ${dir}`);
      return 0;
    case "absent":
      console.error(`${checkId}: this change owes evidence of the result, and there is none.\n`);
      console.error(`Put it in:\n  ${dir}\n`);
      console.error(`${check.description}`);
      console.error(`Outside the repo on purpose: it is never committed and never travels.`);
      return EXIT_FAILED;
    case "empty":
      console.error(`${checkId}: ${verdict.name} is empty. An artifact that carries nothing is`);
      console.error(`not evidence, and this check cannot tell a placeholder from a result.`);
      return EXIT_FAILED;
    case "malformed":
      console.error(`${checkId}: ${verdict.name} does not parse: ${verdict.why}`);
      return EXIT_FAILED;
    case "stale":
      console.error(
        `${checkId}: ${verdict.name} predates the code it claims to show by ` +
          `${String(Math.round(verdict.behindMs / 1000))}s. Produce it again.`,
      );
      return EXIT_FAILED;
  }
}

export async function runShippedCheck(
  id: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  const ids = [...Object.keys(RUNNERS), `${EVIDENCE_PREFIX}*`];

  if (id === undefined) {
    console.error(`which check to run: ${ids.join(", ")}`);
    return EXIT_UNKNOWN;
  }

  // A PREFIX, not an entry: what a project must be able to declare is one evidence
  // requirement per kind of result — a screenshot here, a request and response
  // there — and each is a check file of its own with its own `include`.
  const runner = id.startsWith(EVIDENCE_PREFIX)
    ? (cwd: string): Promise<number> => evidence(id, cwd)
    : RUNNERS[id];
  if (runner === undefined) {
    console.error(`\`wst check run\` has no runner for "${id}". It has: ${ids.join(", ")}.`);
    console.error(`A check with a \`command:\` of its own is run by \`wst gate\`, not by this.`);
    return EXIT_UNKNOWN;
  }

  return runner(cwd);
}
