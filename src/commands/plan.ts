/**
 * `wst plan` — the composition root. Read the plan, load the rules and the
 * registry, hand both to the pure core, print. **No decisions are made here**: the
 * tier, the check split and every coverage gap are computed in `src/core/plan/`,
 * where the tests can reach them.
 *
 * ADR-0013, on what this command is: the front door, not a step inside anything,
 * and not gated on criticality — "the moment a plan is worth checking is *before*
 * anyone knows how critical the change is."
 *
 * It writes nothing. No signal, no event, no receipt: reading a plan is not a run,
 * and a command that logs would give the retro a stream of activity that never
 * verified anything.
 */

import { readFile } from "node:fs/promises";
import { parsePlan, PlanParseError } from "../core/plan/parse.js";
import { previewPlan } from "../core/plan/preview.js";
import { renderPlanPreview } from "../core/plan/report.js";
import { createGitAdapter } from "../shell/git.js";
import { loadRegistry, loadTriageRules, resolveDefinitionRoot } from "../shell/sdd.js";

export interface PlanOptions {
  /** The plan file. Omitted means stdin, so a plan can be piped straight in. */
  readonly file?: string;
  readonly json?: boolean;
}

/** What `source` is called when the plan came down the pipe. */
const STDIN = "-";

/**
 * The only nonzero code this command has, and it never means "the plan is bad".
 *
 * Hard rule 3, applied one layer before the gate: a command that could not RUN is
 * broken, not a verdict. `wst plan` has no verdict at all — it does not block — so
 * exit 1 is deliberately left unused. Everywhere else in this CLI 1 means "the
 * change was rejected", and a script reading a 1 from here would conclude something
 * this command is not entitled to say.
 */
const EXIT_COULD_NOT_RUN = 2;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function runPlan(opts: PlanOptions = {}, cwd: string = process.cwd()): Promise<number> {
  const source = opts.file ?? STDIN;

  let text: string;
  try {
    if (opts.file === undefined) {
      if (process.stdin.isTTY === true) {
        // Otherwise the command hangs on an empty terminal and looks like it is
        // thinking. Naming both inputs is what makes the recovery obvious.
        console.error("no plan file given, and stdin is a terminal — pass a file or pipe a plan in");
        return EXIT_COULD_NOT_RUN;
      }
      text = await readStdin();
    } else {
      text = await readFile(opts.file, "utf-8");
    }
  } catch (cause) {
    console.error(`could not read the plan from ${source}\n  ${(cause as Error).message}`);
    return EXIT_COULD_NOT_RUN;
  }

  let plan;
  try {
    plan = parsePlan(text, source);
  } catch (cause) {
    // A plan this parser rejects is one whose declared paths would classify to a
    // confident wrong tier. Reporting the tier anyway is the failure ADR-0013 says
    // would make the whole command worth deleting.
    if (cause instanceof PlanParseError) {
      console.error(cause.message);
      return EXIT_COULD_NOT_RUN;
    }
    throw cause;
  }

  const git = createGitAdapter(cwd);
  const repoRoot = (await git.repoRoot()) ?? cwd;

  let registry;
  let rules;
  try {
    const root = await resolveDefinitionRoot(repoRoot);
    [registry, rules] = await Promise.all([loadRegistry(root), loadTriageRules(root)]);
  } catch (cause) {
    // Same posture as `wst triage` and `wst gate`: configuration that will not load
    // means the answer would be computed from rules nobody wrote.
    console.error(`plan configuration failed to load\n  ${(cause as Error).message}`);
    return EXIT_COULD_NOT_RUN;
  }

  const preview = previewPlan(plan.paths, rules.rules, rules.origin, registry);

  if (opts.json === true) {
    console.log(
      JSON.stringify({ source, intent: plan.intent, declared: plan.paths, ...preview }, null, 2),
    );
    return 0;
  }

  console.log(renderPlanPreview(preview, { intent: plan.intent, source }));
  return 0;
}
