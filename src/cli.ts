#!/usr/bin/env node
/**
 * `wst` — wiring only. Every command delegates immediately to `src/commands/`;
 * no logic lives here, so the CLI surface stays swappable.
 */

import { CWD_FAILURE, requireCwd } from "./shell/cwd.js";
import { Command, Option } from "commander";
import { banner } from "./banner.js";
import { runStatus } from "./commands/status.js";
import { runCheck } from "./commands/check.js";
import { runTriage } from "./commands/triage.js";
import { runGate } from "./commands/gate.js";
import { runReady } from "./commands/ready.js";
import { runInit } from "./commands/init.js";
import { runShippedCheck } from "./commands/run.js";
import { TIERS, type Tier } from "./core/checks/schema.js";
import { DEFINITION_DIR } from "./core/paths.js";
import { createRequire } from "node:module";

// Read, not retyped. It was hand-kept in step with package.json and drifted the
// first time only one of them was bumped — `wst --version` said 0.4.0-alpha while
// the package it came from said 0.5.0-alpha, which is the one number a user
// checks to know what they are running.
const VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const program = new Command();

program
  .name("wst")
  .description(
    "Whetstone: check the work before handing it back. Finds what changed in a worktree, " +
      "runs the project's applicable checks, and says what passed, failed or could not be verified.",
  )
  .version(VERSION)
  // Only on the bare `wst`, where a human is looking at the tool rather than at a
  // result. Commander prints this above the usage text.
  .addHelpText("beforeAll", `\n${banner(VERSION)}\n`);

program
  .command("init")
  .helpGroup("Commands:")
  .description(`interview this repo and generate its ${DEFINITION_DIR}/`)
  .option("--answers <file>", "JSON file of interview answers")
  .option("--risk <flags>", "comma-separated: money,personalData,productionData,authn,safetyCritical")
  .option("--source <glob...>", "where this project's code lives: scopes the checks and the triage rules")
  // Accepted and ignored: 0.9 printed them in its own example, and an agent following it
  // would otherwise be told "did you mean --propose?", the one flag that spends money.
  .addOption(new Option("--purpose <text>").hideHelp())
  .addOption(new Option("--stack <text>").hideHelp())
  .option("--strict <glob:reason...>", "a strict path and why it earns full TDD")
  .option("--propose", "write the judge's draft to a file instead of into the questions")
  .option("--enforce", "also write a pre-push hook and an AGENTS.md stanza, without asking")
  .option("--out <file>", "where --propose writes its draft (default .wst-answers.json)")
  .option("--llm", "also seed an uncalibrated review lens (capped at warn)")
  .option("--definitions-only", `write ${DEFINITION_DIR}/ and nothing else: no AGENTS.md, no CLAUDE.md`)
  .option("--force", "overwrite existing files, listing them first")
  .option("--dry-run", "show the plan, write nothing")
  .option("--no-probe", "do not run this repo's own commands; every seeded check starts at warn")
  .option("--json", "print the plan as JSON")
  .action(async (opts: Parameters<typeof runInit>[0]) => {
    process.exitCode = await runInit(opts);
  });

program.action(() => {
  program.outputHelp();
});

program
  .command("ready")
  .helpGroup("Commands:")
  .description("is this task's work ready? resolves its own scope, no range needed")
  .option("--json", "the report as a JSON envelope, with a semantic `result` field")
  .option("--range <range>", "advanced: verify this range instead of the resolved scope")
  .option("--fast", "run only the checks that do not declare themselves slow")
  .option("--no-evidence", "no evidence store on this machine, so those checks cannot answer")
  .option("--lens", "run llm checks too; off by default")
  .action(async (opts: NonNullable<Parameters<typeof runReady>[0]> & { evidence?: boolean }) => {
    process.exitCode = await runReady({ ...opts, noEvidence: opts.evidence === false });
  });

program
  .command("status")
  .helpGroup("Commands:")
  .description(`show repo, ${DEFINITION_DIR}/ and judge-adapter health`)
  .option("--quiet", "print only the final installation ok / NOT ok line")
  .option("--json", "the same answer as data, for an agent rather than a reader")
  .action(async (opts: { quiet?: boolean; json?: boolean }) => {
    process.exitCode = await runStatus(requireCwd(), {
      quiet: opts.quiet ?? false,
      json: opts.json ?? false,
    });
  });

const check = program
  .command("check")
  .helpGroup("Diagnostics and compatibility:")
  .description(`diagnostic: list the check registry from ${DEFINITION_DIR}/checks/`)
  .option("--json", "print the compiled index as JSON")
  .option("--compile", `write ${DEFINITION_DIR}/checks/_index.json`)
  .action(async (opts: { json?: boolean; compile?: boolean }) => {
    process.exitCode = await runCheck(opts);
  });

// A subcommand and not a command of its own: a seeded check names this in its
// `command:`, and the noun it runs under should be the noun the thing is.
check
  .command("run")
  .helpGroup("Commands:")
  .argument("[id]", "which check Whetstone ships the logic for")
  .description("run a check whose logic ships with wst rather than with this repo")
  .action(async (id: string | undefined) => {
    process.exitCode = await runShippedCheck(id);
  });

program
  .command("triage")
  .helpGroup("Diagnostics and compatibility:")
  .description("diagnostic: classify a change into a tier and show which checks apply")
  // No commander default: a default --range makes --paths look like both were
  // passed. runTriage still falls back to HEAD when neither is given.
  .option("--range <range>", "git diff range (default: HEAD)")
  .option(
    "--paths <path...>",
    "repo-relative paths you are ABOUT to touch; classified without reading a diff",
  )
  .option("--json", "print the result as JSON")
  .option("--why", "show the rule that matched each file")
  .action(async (opts: { range?: string; paths?: string[]; json?: boolean; why?: boolean }) => {
    process.exitCode = await runTriage(opts);
  });
program
  .command("gate")
  .helpGroup("Diagnostics and compatibility:")
  .description("compatibility: run the checks over a range. `ready` resolves its own")
  .option("--range <range>", "git diff range", "HEAD")
  .option("--tier <tier>", "provisional triage tier override")
  .option("--json", "print the verdict as JSON")
  .option("--no-lens", "skip llm checks (fast and free; for the pre-push hook)")
  .option("--no-evidence", "no evidence store on this machine, so those checks cannot answer")
  .option("--fast", "run only the checks that do not declare themselves slow")
  .option("--no-emit", "no-op since 0.10, accepted so hooks written earlier keep working")
  .action(async (opts: { range?: string; tier?: string; json?: boolean; lens?: boolean; evidence?: boolean; fast?: boolean }) => {
    // Validate rather than cast: an unrecognised --tier must be rejected loudly.
    // Silently coercing it would let `--tier=stict` run the gate at the wrong
    // discipline while reporting success.
    if (opts.tier !== undefined && !(TIERS as readonly string[]).includes(opts.tier)) {
      console.error(`unknown tier "${opts.tier}". Expected one of: ${TIERS.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    const tier = opts.tier as Tier | undefined;
    // Exit codes are a channel of their own: 0 pass · 1 blocked · 2 a
    // block-severity check never ran. Exit 0 on 2 would let a permanently broken
    // judge silently disable the gate; exit 1 would tell CI the change is bad
    // when the truth is that we do not know.
    process.exitCode = await runGate({
      ...(opts.range !== undefined ? { range: opts.range } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(opts.json !== undefined ? { json: opts.json } : {}),
      ...(opts.lens === false ? { noLens: true } : {}),
      ...(opts.evidence === false ? { noEvidence: true } : {}),
      ...(opts.fast === true ? { fast: true } : {}),
    });
  });

/**
 * EXIT 2 for every throw, a stack for the unexpected ones. Hard rule 3 applied to
 * Whetstone itself: rethrowing let node exit 1, the code for "a check failed", so a
 * crash that ran nothing told an agent its correct code was broken.
 */
try {
  await program.parseAsync(process.argv);
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.startsWith("wst.yaml:") || message.startsWith(CWD_FAILURE)) {
    console.error(message);
  } else {
    console.error(cause instanceof Error && cause.stack !== undefined ? cause.stack : message);
    console.error("\nwhetstone crashed before it could finish. Nothing was verified by this run.");
  }
  process.exitCode = 2;
}
