/**
 * `wst check run <id>` — run a check whose logic Whetstone ships rather than
 * shells out for.
 *
 * It exists so a seeded check can name a command the target repo already has.
 * `npm run check:comments` names a script nobody wrote there (adr-0025), and the
 * binary that wrote the check file is the one thing it can count on being there.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  addedLines,
  addedLinesOfNewFile,
  commentLines,
  judgeDensity,
  removedCommentIn,
  MAX_PERCENT,
} from "../core/checks/comment-density.js";
import { gitEnv } from "../shell/git.js";

/** The ids `wst check run` answers to. One entry, one runner, no catalogue. */
const RUNNERS: Readonly<Record<string, (cwd: string) => Promise<number>>> = {
  "comment-density": commentDensity,
};

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

export async function runShippedCheck(
  id: string | undefined,
  cwd: string = process.cwd(),
): Promise<number> {
  const ids = Object.keys(RUNNERS);

  if (id === undefined) {
    console.error(`which check to run: ${ids.join(", ")}`);
    return EXIT_UNKNOWN;
  }

  const runner = RUNNERS[id];
  if (runner === undefined) {
    console.error(`\`wst check run\` has no runner for "${id}". It has: ${ids.join(", ")}.`);
    console.error(`A check with a \`command:\` of its own is run by \`wst gate\`, not by this.`);
    return EXIT_UNKNOWN;
  }

  return runner(cwd);
}
