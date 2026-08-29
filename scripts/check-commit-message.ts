/**
 * This repo's own invocation of `commit-message`.
 *
 * The logic is in `src/core/checks/` and the runner in `src/commands/run.ts`, so a
 * bootstrapped repo gets `wst check run commit-message` and this one gets the
 * script it already had a habit of running. `wst` on PATH is a DIFFERENT checkout
 * here, which is why the check file names the script and not the binary.
 */

import { runShippedCheck } from "../src/commands/run.js";

process.exitCode = await runShippedCheck("commit-message");
