#!/usr/bin/env node
/**
 * Snapshots the working tree before a command that would discard it, then asks.
 *
 * `sig-ea119c62`: an hour of work went to `git checkout <path>`. No gate can catch
 * that — the work is gone before any diff exists — and git has no veto point either:
 * there is no `pre-checkout`, and `post-checkout` fires too late. The harness is the
 * only place this can live.
 *
 * ASKS, never denies. Discarding work is sometimes the intent; what was missing is
 * the moment of saying so. And the snapshot means a yes is still recoverable.
 */

import { execFileSync } from "node:child_process";

const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

/** The forms git will NOT protect you from. A branch switch is absent: git refuses those itself. */
const DESTRUCTIVE = [
  /\bgit\s+checkout\s+(--\s+|.*\.[a-z]+)/,
  /\bgit\s+restore\s+(?!--staged\b)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+.*-[a-zA-Z]*f/,
  /\bgit\s+stash\s+(drop|clear)\b/,
  /\bgit\s+checkout\s+-f\b/,
];

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command;
try {
  command = JSON.parse(input)?.tool_input?.command;
} catch {
  process.exit(0);
}
if (typeof command !== "string" || !DESTRUCTIVE.some((re) => re.test(command))) process.exit(0);

const git = (args) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf-8",
    timeout: 10_000,
  });

let dirty;
try {
  dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  // NOT trimmed: porcelain is `XY<space>PATH`, and trimming eats the leading
  // space of an unstaged line, which then eats the first letter of its path.
} catch {
  process.exit(0); // not a repo, or git is unwell: neither is this hook's business
}
if (dirty.length === 0) process.exit(0);

/** A commit of the working tree, reachable by ref and by nothing else. */
let saved = null;
try {
  const object = git(["stash", "create"]).trim();
  if (object !== "") {
    git(["update-ref", "refs/wst/autosave", object]);
    saved = object.slice(0, 12);
  }
} catch {
  // A snapshot that failed still leaves the question worth asking.
}

const files = dirty.map((l) => l.slice(3)).slice(0, 6);
const more = dirty.length > files.length ? ` (+${dirty.length - files.length} more)` : "";

const reason =
  `This discards uncommitted work in ${dirty.length} file(s): ${files.join(", ")}${more}.\n` +
  (saved === null
    ? "A snapshot could not be taken, so anything discarded here is gone."
    : `A snapshot was taken first. Recover with:\n` +
      `  git show refs/wst/autosave:<path>        # one file\n` +
      `  git stash apply refs/wst/autosave        # everything (${saved})`);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  }),
);
