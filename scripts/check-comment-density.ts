/** How much of what a change ADDS is comment. Rationale in the check file. */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { DEFINITION_DIR } from "../src/core/paths.js";

const exec = promisify(execFile);

const MAX_PERCENT = 25;

/** Below this, one comment on a three-line change reads as 33% and means nothing. */
const MIN_SAMPLE = 15;

const git = async (args: string[]): Promise<string> => {
  const { stdout } = await exec("git", ["-c", "core.quotePath=false", ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

/**
 * Which 1-based lines of `source` are comment, by scanning it.
 *
 * A line starting with `*` is a doc continuation or a markdown bullet inside a
 * template literal, and `init` writes hundreds of the second kind. Only a scanner
 * that knows it is inside a string can tell them apart.
 */
export function commentLines(source: string): ReadonlySet<number> {
  const found = new Set<number>();
  let line = 1;
  let block = false;
  let quote: string | null = null;
  let sawCode = false;
  let blockStart = 0;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      if (block && !sawCode) found.add(line);
      line += 1;
      sawCode = false;
      continue;
    }
    if (block) {
      if (c === "*" && next === "/") {
        if (!sawCode) for (let l = blockStart; l <= line; l += 1) found.add(l);
        block = false;
        i += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      sawCode = true;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      sawCode = true;
      continue;
    }
    if (c === "/" && next === "/") {
      if (!sawCode) found.add(line);
      while (i < source.length && source[i] !== "\n") i += 1;
      i -= 1;
      continue;
    }
    if (c === "/" && next === "*") {
      block = true;
      blockStart = line;
      i += 1;
      continue;
    }
    if (c !== " " && c !== "\t") sawCode = true;
  }
  return found;
}

/** The path a `+++` line names, or null for `+++ /dev/null` (a deleted file). */
const targetOf = (line: string): string | null => /^\+\+\+ b\/(.*)$/.exec(line)?.[1] ?? null;

/** Added line numbers per file, read off `--unified=0` hunk headers. */
export function addedLines(diff: string): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = targetOf(line);
      if (file !== null) byFile.set(file, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = byFile.get(file);
    for (let n = start; n < start + count; n += 1) lines?.push(n);
  }
  return byFile;
}

/** Removed comment lines, in the files `keep` accepts. */
export function removedCommentIn(diff: string, keep: (path: string) => boolean): number {
  let file: string | null = null;
  let count = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = targetOf(line);
      continue;
    }
    if (file === null || !keep(file)) continue;
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const text = line.slice(1).trim();
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) count += 1;
  }
  return count;
}

/** Where the diff ENDS: the right side of a range, or the working tree. */
const endOf = (range: string): string | null => {
  const dots = range.lastIndexOf("..");
  if (dots < 0) return null;
  const right = range.slice(dots + 2);
  return right === "" ? "HEAD" : right;
};

const contentsAt = async (path: string, end: string | null): Promise<string> =>
  end === null
    ? readFile(path, "utf-8").catch(() => "")
    : git(["show", `${end}:${path}`]).catch(() => "");

async function main(): Promise<void> {
  const range = process.env["WST_GATE_RANGE"] ?? "HEAD";
  const end = endOf(range);
  const diff = await git(["diff", "--unified=0", range, "--", "*.ts"]);
  const touched = addedLines(diff);

  let comment = 0;
  let code = 0;
  for (const [path, lines] of touched) {
    if (lines.length === 0) continue;
    const text = await contentsAt(path, end);
    const commented = commentLines(text);
    const source = text.split("\n");
    for (const n of lines) {
      if ((source[n - 1] ?? "").trim() === "") continue;
      if (commented.has(n)) comment += 1;
      else code += 1;
    }
  }

  // Counted only in files that also gained lines. A change that deletes a module
  // outright would otherwise buy credit to write prose somewhere else.
  const removed = removedCommentIn(diff, (path) => (touched.get(path)?.length ?? 0) > 0);
  if (removed >= comment) {
    console.error(
      `comment density: ${String(comment)} added, ${String(removed)} removed over ${range} — net reduction`,
    );
    return;
  }

  const total = comment + code;
  if (total < MIN_SAMPLE) {
    console.error(`comment density: ${String(total)} added lines over ${range} — too few to judge`);
    return;
  }

  const percent = Math.round((100 * comment) / total);
  const verdict = `${String(percent)}% of ${String(total)} added .ts lines over ${range} are comment`;

  if (percent > MAX_PERCENT) {
    console.error(`${verdict}, over the ${String(MAX_PERCENT)}% ceiling.\n`);
    console.error(`Comments belong where the code cannot be made clear on its own.`);
    console.error(`History, rejected alternatives and what a module used to do go in the`);
    console.error(`commit body or in ${DEFINITION_DIR}/memory/decisions.md, not above the code.`);
    process.exit(1);
  }

  console.error(`${verdict} — under the ${String(MAX_PERCENT)}% ceiling`);
}

if (process.argv[1]?.endsWith("check-comment-density.ts") === true) await main();
