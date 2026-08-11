#!/usr/bin/env node
/**
 * Runs the gate when Claude finishes, and hands the verdict back into the session.
 *
 * THE POINT. Layers 1 and 2 of this tool both depend on the agent cooperating: the
 * strict-path hook only warns, and "run `wst gate` when you are done" lives as prose in
 * a generated AGENTS.md that an agent has to remember. Layer 3, the pre-push hook,
 * depends on nobody — but it fires long after the session, when the context that could
 * fix the problem is gone.
 *
 * This is the missing rung. The verdict arrives while Claude still holds the work, so
 * it corrects itself before a human looks. By the time you push, the pre-push gate is
 * the net rather than the discovery.
 *
 * `--no-lens` always: this runs on every stop, and a hook that costs money and fifty
 * seconds each time gets disabled, at which point its value is negative. `--no-emit`
 * always: a signal is a record of friction a human hit, not of an agent's inner loop,
 * and emitting here would flood the log the retro reasons over.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

// Drain stdin so the harness never blocks on a hook that ignored its input.
for await (const _ of process.stdin) void _;

/**
 * Every failure to RUN exits silently.
 *
 * No `.wst/`, no `wst` on PATH, not a git repo: none of those are facts about the
 * work, and a hook that complains about its own absence on every stop is a hook
 * people remove. This is the same distinction the gate itself draws between a check
 * that failed and a check that could not run — applied to the hook.
 */
let result;
try {
  result = await run("wst", ["gate", "--no-lens", "--no-emit"], {
    cwd: root,
    timeout: 170_000,
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (cause) {
  const code = cause?.code;
  // A NUMBER is the gate having decided. A STRING (ENOENT) is it never having run.
  if (typeof code !== "number") process.exit(0);

  const out = `${cause.stdout ?? ""}${cause.stderr ?? ""}`.trim();

  // 2 is EXIT_MISCONFIGURED: the gate could not start. Not a verdict about the work,
  // so it must not read to Claude as "you broke something".
  if (code === 2) process.exit(0);

  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        `The Whetstone gate BLOCKED this change. This is not advisory — the work is not ` +
        `done until it passes.\n\n${out}\n\n` +
        `Fix the failing check and run \`wst gate --no-lens --no-emit\` yourself to confirm. ` +
        `Do not weaken or skip the check to make it pass; if the check itself is wrong, ` +
        `say so and stop rather than editing it.`,
    }),
  );
  process.exit(0);
}

// Passed. Say nothing: a hook that speaks on success is noise on every single stop.
void result;
process.exit(0);
