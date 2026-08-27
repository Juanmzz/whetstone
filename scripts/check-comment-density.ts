/**
 * This repo's own invocation of `comment-density`.
 *
 * The logic is in `src/core/checks/` and the runner in `src/commands/run.ts`, so a
 * bootstrapped repo gets `wst check run comment-density` and this one gets the
 * same code without needing `wst` on PATH inside CI.
 */

import { runShippedCheck } from "../src/commands/run.js";

process.exitCode = await runShippedCheck("comment-density");
