/**
 * Parsing for `git diff --name-status`. PURE — the shell adapter fetches the raw
 * text, this turns it into data.
 *
 * Design note: this deliberately THROWS on anything it does not understand. A gate
 * that silently drops an unparsed line leaves that file UNGATED, which is the worst
 * possible failure for a tool whose job is to not let things through.
 */

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface ChangedFile {
  /** Always the file's path AFTER the change — triage classifies what it became. */
  readonly path: string;
  readonly status: ChangeStatus;
  /** Only present for renames and copies. */
  readonly oldPath?: string;
}

/** Single-path status letters. `T` (typechange) counts as a modification. */
const SIMPLE_STATUS: Readonly<Record<string, ChangeStatus>> = {
  A: "added",
  M: "modified",
  D: "deleted",
  T: "modified",
};

export function parseNameStatus(raw: string): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;

    const parts = line.split("\t");
    const code = parts[0];
    if (code === undefined || code === "" || parts.length < 2) {
      throw new Error(`unparseable --name-status line: ${JSON.stringify(line)}`);
    }

    // Renames and copies carry a similarity score (R100, C75) and TWO paths.
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath === undefined || newPath === undefined || newPath === "") {
        throw new Error(
          `rename/copy line is missing its destination path: ${JSON.stringify(line)}`,
        );
      }
      files.push({
        path: newPath,
        status: letter === "R" ? "renamed" : "copied",
        oldPath,
      });
      continue;
    }

    const status = letter === undefined ? undefined : SIMPLE_STATUS[letter];
    if (status === undefined) {
      throw new Error(
        `unknown git status ${JSON.stringify(code)} in line ${JSON.stringify(line)}`,
      );
    }

    const path = parts[1];
    if (path === undefined || path === "") {
      throw new Error(`unparseable --name-status line: ${JSON.stringify(line)}`);
    }
    files.push({ path, status });
  }

  return files;
}

/**
 * The same statuses, read from `git diff --name-status -z`.
 *
 * The line format ESCAPES: a path holding a tab arrives as `"special/a\tb.js"`,
 * quotes included, no glob matches it, and the file goes through ungated under a
 * report saying `Ready`. `core.quotePath=false` governs non-ASCII bytes only; git
 * quotes control characters regardless, so `-z` is the only reader with nothing to
 * undo. The stream is flat: `STATUS NUL path NUL`, plus a second path for R and C.
 */
export function parseNameStatusZ(raw: string): ChangedFile[] {
  const tokens = raw.split("\0");
  // A trailing NUL terminates the last field rather than starting a new one.
  if (tokens.at(-1) === "") tokens.pop();

  const files: ChangedFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i];
    i += 1;
    if (code === undefined || code === "") continue;

    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[i];
      const newPath = tokens[i + 1];
      i += 2;
      if (oldPath === undefined || newPath === undefined || newPath === "") {
        throw new Error(`rename/copy entry is missing its destination path: ${JSON.stringify(code)}`);
      }
      files.push({ path: newPath, status: letter === "R" ? "renamed" : "copied", oldPath });
      continue;
    }

    const status = letter === undefined ? undefined : SIMPLE_STATUS[letter];
    if (status === undefined) {
      throw new Error(`unknown git status ${JSON.stringify(code)} in a -z diff`);
    }

    const path = tokens[i];
    i += 1;
    if (path === undefined || path === "") {
      throw new Error(`git status ${JSON.stringify(code)} with no path after it`);
    }
    files.push({ path, status });
  }

  return files;
}
