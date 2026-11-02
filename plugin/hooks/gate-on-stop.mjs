#!/usr/bin/env node
/**
 * Runs `wst ready` when Claude finishes, and hands the verdict back into the session.
 *
 * THE POINT. Layers 1 and 2 of this tool both depend on the agent cooperating: the
 * strict-path hook only warns, and "run `wst gate` when you are done" lives as prose in
 * a generated AGENTS.md that an agent has to remember. Layer 3, the pre-push hook,
 * depends on nobody, but it fires long after the session, when the context that could
 * fix the problem is gone.
 *
 * This is the missing rung. The verdict arrives while Claude still holds the work, so
 * it corrects itself before a human looks. By the time you push, the pre-push gate is
 * the net rather than the discovery.
 *
 * `ready`, not `gate`: `gate` diffs the working tree against HEAD, so an agent that
 * committed before stopping presented an empty diff and passed unverified. `ready`
 * resolves the merge base, sees untracked files, and never exits 0 having verified nothing.
 *
 * MEMORY. A Stop fires per response, not per change. The hook fingerprints the repo
 * (HEAD, status, the content of every changed file, the `wst` version) and keeps the last
 * verdict per worktree in `wst-stop-state.json` under the git dir. The same fingerprint
 * is never judged or reported twice. No git, or an unusable state file, means no memory.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

// True when this Stop is already a continuation caused by a stop hook. Empty or invalid
// input means no flag.
let afterFixAttempt = false;
try {
  afterFixAttempt = JSON.parse(raw)?.stop_hook_active === true;
} catch {}

if (!existsSync(join(root, ".wst"))) process.exit(0);

const say = (message) => console.log(JSON.stringify(message));

async function git(args, cwd = root, input = "") {
  const child = run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  child.child.stdin?.on("error", () => {});
  child.child.stdin?.end(input);
  return (await child).stdout;
}

async function wstVersion() {
  try {
    return (await run("wst", ["--version"], { cwd: root, timeout: 5_000 })).stdout.trim();
  } catch {
    return "";
  }
}

/** null when git cannot answer: the hook then behaves as it did before it had memory. */
async function fingerprint() {
  try {
    const top = (await git(["rev-parse", "--show-toplevel"])).trim();
    const state = resolve(root, (await git(["rev-parse", "--git-path", "wst-stop-state.json"])).trim());
    const head = await git(["rev-parse", "--verify", "-q", "HEAD"]).then((s) => s.trim(), () => "unborn");
    const status = await git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);

    const tokens = status.split("\0");
    const paths = [];
    for (let i = 0; i < tokens.length; i++) {
      const entry = tokens[i];
      if (entry === "") continue;
      paths.push(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2))) i++;
    }

    const files = [];
    const links = [];
    for (const path of paths) {
      try {
        const stat = lstatSync(join(top, path));
        if (stat.isSymbolicLink()) links.push(`${path}\0${readlinkSync(join(top, path))}`);
        else if (stat.isFile() && !path.includes("\n")) files.push(path);
      } catch {}
    }
    const hashes = files.length === 0 ? [] : (await git(["hash-object", "--stdin-paths"], top, `${files.join("\n")}\n`)).split("\n");

    const hash = createHash("sha256")
      .update([head, status, await wstVersion(), ...files.map((f, i) => `${f}\0${hashes[i]}`), ...links].join("\0\0"))
      .digest("hex");
    return { hash, state };
  } catch {
    return null;
  }
}

async function recall(file) {
  try {
    const saved = JSON.parse(await readFile(file, "utf-8"));
    return typeof saved?.fingerprint === "string" && typeof saved?.verdict === "string" ? saved : null;
  } catch {
    return null;
  }
}

async function remember(file, saved) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(saved), "utf-8");
    await rename(temp, file);
  } catch {
    await rm(temp, { force: true }).catch(() => {});
  }
}

function parse(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** The reason plus each failing check and what it printed; the raw output when there is no envelope to read. */
function describe(envelope, fallback) {
  if (envelope === null) return fallback;
  const parts = [];
  if (typeof envelope.reason === "string" && envelope.reason !== "") parts.push(envelope.reason);
  for (const r of Array.isArray(envelope.results) ? envelope.results : []) {
    if (r?.status !== "fail" && r?.status !== "errored") continue;
    const head = r.status === "errored" ? `ERROR ${r.id} (could not run)` : `FAIL ${r.id}`;
    const detail = Array.isArray(r.detail) ? r.detail.map((line) => `    ${line}`) : [];
    parts.push([head, ...detail].join("\n"));
  }
  return parts.length === 0 ? fallback : parts.join("\n\n");
}

const empty = (value) => Array.isArray(value) && value.length === 0;

function uncoveredOnly(envelope) {
  return (
    envelope?.result === "INCOMPLETE" &&
    Array.isArray(envelope.uncovered) &&
    envelope.uncovered.length > 0 &&
    empty(envelope.applicable) &&
    empty(envelope.declined)
  );
}

/**
 * Every failure to RUN exits silently.
 *
 * No `.wst/`, no `wst` on PATH, not a git repo: none of those are facts about the
 * work, and a hook that complains about its own absence on every stop is a hook
 * people remove. This is the same distinction the gate itself draws between a check
 * that failed and a check that could not run, applied to the hook.
 */
async function ready() {
  try {
    const done = await run("wst", ["ready", "--json"], { cwd: root, timeout: 170_000, maxBuffer: 8 * 1024 * 1024 });
    const envelope = parse(done.stdout);
    return { kind: envelope?.result === "NO_CHANGES" ? "NO_CHANGES" : "READY", envelope: null, text: "" };
  } catch (cause) {
    const code = cause?.code;
    // A NUMBER is the gate having decided. A STRING (ENOENT) is it never having run.
    // A signal (the timeout kill) is it having started and never answered.
    const killed = code === null || code === undefined ? cause?.signal : undefined;
    if (typeof code !== "number" && killed === undefined) process.exit(0);

    const out = `${cause.stdout ?? ""}${cause.stderr ?? ""}`.trim();
    const envelope = parse(cause.stdout ?? "");
    const kind = killed !== undefined ? "killed" : code === 2 ? "INCOMPLETE" : "NOT_READY";
    return { kind, envelope, text: describe(envelope, out) };
  }
}

await main();

async function main() {
  const now = await fingerprint();
  const before = now === null ? null : await recall(now.state);
  const same = before !== null && before.fingerprint === now.hash;

  if (same && before.verdict !== "killed") {
    if (before.verdict === "NOT_READY" && afterFixAttempt && before.told !== true) {
      await remember(now.state, { ...before, told: true });
      say({ systemMessage: "Whetstone ready is still NOT_READY and nothing has changed since it last reported. Not ready to report." });
    }
    return;
  }

  const { kind, envelope, text } = await ready();
  if (same && kind === "killed") return;

  // After a fix attempt nothing may continue the turn (additionalContext does, like a block),
  // so the user alone is told.
  const told = afterFixAttempt && (kind === "NOT_READY" || kind === "INCOMPLETE" || kind === "killed");
  if (now !== null) await remember(now.state, { fingerprint: now.hash, verdict: kind, told: kind === "NOT_READY" && told });

  if (kind === "READY" || kind === "NO_CHANGES") return;

  if (kind === "INCOMPLETE" && uncoveredOnly(envelope)) {
    say({ systemMessage: `Whetstone ready answered INCOMPLETE: no check covers the changed paths. Nothing for the agent to fix.\n\n${text}` });
    return;
  }

  if (told) {
    const state = kind === "NOT_READY" ? "is still NOT_READY" : kind === "INCOMPLETE" ? "is still INCOMPLETE" : "did not finish";
    say({ systemMessage: `Whetstone ready ${state} after a fix attempt. Not ready to report.\n\n${text}` });
    return;
  }

  if (kind === "NOT_READY") {
    say({
      decision: "block",
      reason:
        `Whetstone ready says this change is NOT_READY. This is not advisory; the work is not ` +
        `done until it passes.\n\n${text}\n\n` +
        `Fix the failing check and run \`wst ready\` yourself to confirm. ` +
        `Do not weaken or skip the check to make it pass; if the check itself is wrong, ` +
        `say so and stop rather than editing it.`,
    });
    return;
  }

  const lead =
    kind === "INCOMPLETE"
      ? `Whetstone ready answered INCOMPLETE: this change is not fully verified. `
      : `Whetstone ready did not finish, so this change is not verified. `;
  say({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `${lead}This is not a failed check. Do not report the work as verified.\n\n${text}`,
    },
  });
}
