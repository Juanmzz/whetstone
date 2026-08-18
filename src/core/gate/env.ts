/**
 * What a check is told about the checkout it is verifying.
 *
 * PURE. `node:crypto` is a built-in with no effects, allowed here by the same rule
 * that lets `core/receipts/hash.ts` use it: the boundary is about EFFECTS, not
 * built-ins.
 *
 * ## The failure this exists for
 *
 * A check runs as a shell command in a working directory, and until now that was
 * all it knew. Observed in a real repo running five agents in leased worktrees: an
 * end-to-end check configured with Playwright's `reuseExistingServer: true` found
 * a dev server already listening on the shared port, attached to it, and passed —
 * **against a different worktree's code.** The gate reported a verdict on a
 * checkout it had never read.
 *
 * That is worse than every other kind of gate failure. A check that errors is the
 * gate being broken and says so; a check that blocks wrongly is annoying and
 * visible. A check that PASSES for the wrong tree is indistinguishable from
 * working, and it removes the only reason to run a gate at all.
 *
 * ## What Whetstone can and cannot do about it
 *
 * It cannot know what a command does. It cannot rewrite someone's Playwright
 * config, and guessing which commands bind ports would be the same inference
 * adr-0016 took out of `init`.
 *
 * What it can do is stop withholding the one fact that makes the fix a single
 * line. A repo that knows which checkout it is being run for can say
 * `reuseExistingServer: !process.env.WST_GATE_CWD`, or bind
 * `3000 + Number(process.env.WST_GATE_PORT_OFFSET ?? 0)`, and the collision is
 * gone. The variables are the contract; what a repo does with them is its own.
 */

import { createHash } from "node:crypto";

/** Distinct per checkout, and low enough to stay inside the ephemeral range. */
const PORT_SPACE = 1000;

/**
 * The parent environment plus what the gate knows about this run.
 *
 * The gate's values are written LAST on purpose. A leased worktree inherits the
 * environment of whatever session leased it, so an inherited `WST_GATE_CWD` names
 * the checkout that ran the gate BEFORE this one — which is precisely the stale
 * identity that produced the false pass.
 */
export function checkEnv(
  parent: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Record<string, string | undefined> {
  return {
    ...parent,
    /** Absolute path of the checkout under verification. */
    WST_GATE_CWD: cwd,
    /**
     * A stable number in [0, 1000) derived from that path. Stable because a
     * receipt claims a check passed on an input, and a check whose port moved
     * between runs did not run on the same input twice.
     */
    WST_GATE_PORT_OFFSET: String(
      parseInt(createHash("sha256").update(cwd).digest("hex").slice(0, 8), 16) % PORT_SPACE,
    ),
  };
}
