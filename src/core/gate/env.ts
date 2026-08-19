/**
 * What a check is told about the checkout it verifies. PURE.
 *
 * A Playwright check with `reuseExistingServer` attached to a sibling worktree's
 * dev server and passed against the wrong code (sig-0042). These variables are
 * what let a repo tell its own checkout apart.
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
