#!/usr/bin/env node
/**
 * Runs `wst ready` when Claude finishes, and hands the verdict back into the session.
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
 * `ready`, not `gate`: `gate` diffs the working tree against HEAD, so an agent that
 * committed before stopping presented an empty diff and passed unverified. `ready`
 * resolves the merge base, sees untracked files, and never exits 0 having verified nothing.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

// Drain stdin so the harness never blocks on a hook that ignored its input.
for await (const _ of process.stdin) void _;

if (!existsSync(join(root, ".wst"))) process.exit(0);

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
  result = await run("wst", ["ready"], {
    cwd: root,
    timeout: 170_000,
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (cause) {
  const code = cause?.code;
  // A NUMBER is the gate having decided. A STRING (ENOENT) is it never having run.
  if (typeof code !== "number") process.exit(0);

  const out = `${cause.stdout ?? ""}${cause.stderr ?? ""}`.trim();

  // 2 is every way of NOT having a verdict. It must not read as "you broke something",
  // and silence would read as a pass, so it is told as neither.
  if (code === 2) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext:
            `Whetstone ready could not run, so this change was NOT verified. ` +
            `This is not a failed check. Do not report the work as verified.\n\n${out}`,
        },
      }),
    );
    process.exit(0);
  }

  console.log(
    JSON.stringify({
      decision: "block",
      reason:
        `Whetstone ready says this change is NOT_READY. This is not advisory; the work is not ` +
        `done until it passes.\n\n${out}\n\n` +
        `Fix the failing check and run \`wst ready\` yourself to confirm. ` +
        `Do not weaken or skip the check to make it pass; if the check itself is wrong, ` +
        `say so and stop rather than editing it.`,
    }),
  );
  process.exit(0);
}

// READY or NO_CHANGES. Say nothing: a hook that speaks on success is noise on every single stop.
void result;
process.exit(0);
