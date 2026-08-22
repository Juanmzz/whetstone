/**
 * This repo's own invocation of the `comment-density` opinion.
 *
 * The logic is in `src/core/opinions/` and the runner in `src/commands/opinion.ts`,
 * so a bootstrapped repo gets `wst opinion comment-density` and this one gets the
 * same code without needing `wst` on PATH inside CI.
 */

import { runOpinion } from "../src/commands/opinion.js";

process.exitCode = await runOpinion("comment-density");
