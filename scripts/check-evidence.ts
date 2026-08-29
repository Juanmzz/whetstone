/**
 * This repo's own invocation of an evidence requirement.
 *
 * Same argument as `check-comment-density.ts`: the logic is in `src/core/checks/`
 * and the runner in `src/commands/run.ts`, so a bootstrapped repo gets
 * `wst check run evidence-<name>` and this one gets the same code without needing
 * `wst` on PATH. The id is an argument because a project declares one requirement
 * per kind of result, each a check file with its own `include`.
 */

import { runShippedCheck } from "../src/commands/run.js";

process.exitCode = await runShippedCheck(process.argv[2]);
