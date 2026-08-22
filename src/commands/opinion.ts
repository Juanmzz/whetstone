/**
 * `wst opinion <id>` — run one of the rules Whetstone offers and no repo declares.
 *
 * It exists so a seeded check can name something the target repo already has.
 * `npm run check:comments` names a script nobody wrote there (adr-0025).
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  addedLines,
  commentLines,
  judgeDensity,
  removedCommentIn,
  MAX_PERCENT,
} from "../core/opinions/comment-density.js";
import { OPINIONS, opinionById } from "../core/opinions/index.js";
import { gitEnv } from "../shell/git.js";

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
        `comment density: ${String(verdict.added)} added, ${String(verdict.removed)} removed over ${range} — net reduction`,
      );
      return 0;
    case "too-few":
      console.error(`comment density: ${String(verdict.total)} added lines over ${range} — too few to judge`);
      return 0;
    case "under":
      console.error(
        `${String(verdict.percent)}% of ${String(verdict.total)} added .ts lines over ${range} are comment — under the ${String(MAX_PERCENT)}% ceiling`,
      );
      return 0;
    case "over":
      console.error(
        `${String(verdict.percent)}% of ${String(verdict.total)} added .ts lines over ${range} are comment, over the ${String(MAX_PERCENT)}% ceiling.\n`,
      );
      console.error(`Comments belong where the code cannot be made clear on its own.`);
      console.error(`History and rejected alternatives go in the commit body, not above the code.`);
      return EXIT_FAILED;
  }
}

export async function runOpinion(id: string | undefined, cwd: string = process.cwd()): Promise<number> {
  if (id === undefined) {
    console.error("what Whetstone has an opinion about, and why:\n");
    for (const o of OPINIONS) {
      console.error(`  ${o.id}`);
      console.error(`    ${o.title}`);
      console.error(`    ${o.friction} (${o.origin.join(", ")})\n`);
    }
    return 0;
  }

  if (opinionById(id) === null) {
    console.error(`no opinion "${id}". Run \`wst opinion\` for the list.`);
    return EXIT_UNKNOWN;
  }

  switch (id) {
    case "comment-density":
      return commentDensity(cwd);
    default:
      // Reachable only if the catalogue gains an entry and this switch does not.
      console.error(`"${id}" is listed but has no runner — that is a bug in wst, not in this repo.`);
      return EXIT_UNKNOWN;
  }
}
