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
 *
 * The repository is resolved FROM THE PATHS THE COMMAND NAMES, never from the
 * caller's project dir, and a command it cannot verify is asked about rather than
 * waved through. A guard that fails OPEN is worse than no guard, because you
 * believe you are protected — the lesson `docs/lanes.yaml` records about the lane
 * guard, arrived at here by the same route: testing it, not reasoning about it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

let input = "";
for await (const chunk of process.stdin) input += chunk;

let command;
try {
  command = JSON.parse(input)?.tool_input?.command;
} catch {
  process.exit(0);
}
if (typeof command !== "string" || command.trim() === "") process.exit(0);

/** Command-line pieces, split on the operators a shell would, ignoring quoted ones. */
function segments(line) {
  const out = [];
  let buf = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      buf += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|" || c === "&") {
      if ((c === "|" || c === "&") && line[i + 1] === c) i++;
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.filter((s) => s.trim() !== "");
}

/** One segment's argv, with quoting and backslash escapes removed. */
function tokens(segment) {
  const out = [];
  let buf = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote !== null) {
      if (c === "\\" && quote === '"') buf += segment[++i] ?? "";
      else if (c === quote) quote = null;
      else buf += c;
      started = true;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push(buf);
      buf = "";
      started = false;
      continue;
    }
    if (c === "\\") buf += segment[++i] ?? "";
    else buf += c;
    started = true;
  }
  if (started) out.push(buf);
  return out;
}

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

/** The worktree a path belongs to. `.git` is a FILE in a worktree, so test presence only. */
function rootOf(target) {
  let dir = path.resolve(target);
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  for (;;) {
    if (exists(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Everything after `--`; otherwise the non-flag arguments, optionally only real ones. */
function pathspecs(args, here, mustExist) {
  const cut = args.indexOf("--");
  if (cut !== -1) return args.slice(cut + 1);
  const bare = args.filter((a) => !a.startsWith("-"));
  return mustExist ? bare.filter((a) => exists(path.resolve(here, a))) : bare;
}

const shortFlags = (args) =>
  args.filter((a) => /^-[a-zA-Z]+$/.test(a)).join("") + args.filter((a) => a.startsWith("--")).join(" ");

/**
 * What a git subcommand would discard, or null for the ones that discard nothing.
 * `paths: null` means the whole worktree, which is not the same as naming none.
 */
function discards(sub, args, here) {
  const flags = shortFlags(args);
  if (sub === "checkout") {
    const named = pathspecs(args, here, true);
    if (named.length > 0) return { paths: named };
    return /f/.test(flags.replace(/--\S+/g, "")) || flags.includes("--force") ? { paths: null } : null;
  }
  if (sub === "restore") {
    if (args.includes("--staged") && !args.includes("--worktree")) return null;
    const named = pathspecs(args, here, false).filter((a) => a !== "");
    return { paths: named.length > 0 ? named : null };
  }
  if (sub === "reset") return args.includes("--hard") ? { paths: null } : null;
  if (sub === "clean") {
    if (!/f/.test(flags.replace(/--\S+/g, "")) && !args.includes("--force")) return null;
    return { paths: pathspecs(args, here, false), ignored: /[xX]/.test(flags) };
  }
  if (sub === "stash" && (args[0] === "drop" || args[0] === "clear")) return { always: true };
  return null;
}

/** Groups to interrogate, one per repository the command reaches into. */
const targets = new Map();
let unverifiable = false;
let always = false;
let cwd = HOME;

for (const segment of segments(command)) {
  const argv = tokens(segment);
  if (argv.length === 0) continue;
  if (argv[0] === "cd" && argv[1] !== undefined) {
    cwd = path.resolve(cwd, argv[1]);
    continue;
  }
  if (path.basename(argv[0]) !== "git") continue;

  let here = cwd;
  let i = 1;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-C") here = path.resolve(here, argv[++i] ?? "");
    else if (a === "-c" || a === "--namespace") i++;
    else if (!a.startsWith("-")) break;
  }

  const plan = discards(argv[i], argv.slice(i + 1), here);
  if (plan === undefined || plan === null) continue;
  if (plan.always === true) always = true;

  // No pathspec is the whole worktree, not nothing: `git clean -fx` names none.
  const named = plan.paths ?? [];
  const roots =
    named.length === 0
      ? [[rootOf(here), []]]
      : named.map((p) => [rootOf(path.resolve(here, p)), [path.resolve(here, p)]]);

  for (const [root, paths] of roots) {
    if (root === null) {
      unverifiable = true;
      continue;
    }
    const seen = targets.get(root) ?? { paths: [], whole: false, ignored: false };
    if (paths.length === 0) seen.whole = true;
    else seen.paths.push(...paths);
    if (plan.ignored === true) seen.ignored = true;
    targets.set(root, seen);
  }
}

if (targets.size === 0 && !unverifiable && !always) process.exit(0);

const git = (root, args) =>
  execFileSync("git", ["-c", "core.quotePath=false", "-C", root, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
  });

const doomed = [];
const snapshots = [];

for (const [root, want] of targets) {
  const scope = want.whole ? [] : ["--", ...want.paths];
  let lines;
  try {
    lines = git(root, ["status", "--porcelain", ...(want.ignored ? ["--ignored=matching"] : []), ...scope])
      .split("\n")
      .filter(Boolean);
    // NOT trimmed: porcelain is `XY<space>PATH`, and trimming eats the leading
    // space of an unstaged line, which then eats the first letter of its path.
  } catch {
    unverifiable = true;
    continue;
  }
  if (lines.length === 0) continue;
  doomed.push(...lines.map((l) => l.slice(3)));

  try {
    const object = git(root, ["stash", "create"]).trim();
    if (object !== "") {
      git(root, ["update-ref", "refs/wst/autosave", object]);
      snapshots.push(object.slice(0, 12));
    }
  } catch {
    // A snapshot that failed still leaves the question worth asking.
  }
}

if (doomed.length === 0 && !unverifiable && !always) process.exit(0);

const shown = doomed.slice(0, 6);
const more = doomed.length > shown.length ? ` (+${doomed.length - shown.length} more)` : "";

const what =
  doomed.length > 0
    ? `This discards uncommitted work in ${doomed.length} file(s): ${shown.join(", ")}${more}.`
    : always
      ? "This drops stashed work, which a clean worktree does not show."
      : "";
const blind = unverifiable
  ? "\nPart of this command names a path outside any repository this guard could read, so what it discards is UNVERIFIED."
  : "";
const recover =
  snapshots.length === 0
    ? doomed.length > 0
      ? "\nA snapshot could not be taken, so anything discarded here is gone."
      : ""
    : `\nA snapshot was taken first. Recover with:\n` +
      `  git show refs/wst/autosave:<path>        # one file\n` +
      `  git stash apply refs/wst/autosave        # everything (${snapshots.join(", ")})`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `${what}${blind}${recover}`.trim(),
    },
  }),
);
