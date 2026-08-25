#!/usr/bin/env node
/**
 * `wst` — wiring only. Every command delegates immediately to `src/commands/`;
 * no logic lives here, so the CLI surface stays swappable.
 */

import { Command } from "commander";
import { banner } from "./banner.js";
import { runStatus } from "./commands/status.js";
import { runCheck } from "./commands/check.js";
import { runTriage } from "./commands/triage.js";
import { runGate } from "./commands/gate.js";
import { runRetro } from "./commands/retro.js";
import { runSignal, DEFAULT_PHASE, DEFAULT_SEVERITY } from "./commands/signal.js";
import { runInit } from "./commands/init.js";
import { runOpinion } from "./commands/opinion.js";
import { runUpdate } from "./commands/update.js";
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
  .description("Whetstone: a self-sharpening standards layer for AI coding agents")
  .version(VERSION)
  // Only on the bare `wst`, where a human is looking at the tool rather than at a
  // result. Commander prints this above the usage text.
  .addHelpText("beforeAll", `\n${banner(VERSION)}\n`);

program
  .command("status")
  .description(`show repo, ${DEFINITION_DIR}/ and judge-adapter health`)
  .option("--quiet", "print only the final ready / NOT ready line")
  .option("--json", "the same answer as data, for an agent rather than a reader")
  .action(async (opts: { quiet?: boolean; json?: boolean }) => {
    process.exitCode = await runStatus(process.cwd(), {
      quiet: opts.quiet ?? false,
      json: opts.json ?? false,
    });
  });

program
  .command("check")
  .description(`list the check registry from ${DEFINITION_DIR}/checks/`)
  .option("--json", "print the compiled index as JSON")
  .option("--compile", `write ${DEFINITION_DIR}/checks/_index.json`)
  .action(async (opts: { json?: boolean; compile?: boolean }) => {
    process.exitCode = await runCheck(opts);
  });

program
  .command("triage")
  .description("classify a diff into a tier and show which checks apply")
  .option("--range <range>", "git diff range", "HEAD")
  .option("--json", "print the result as JSON")
  .option("--why", "show the rule that matched each file")
  .action(async (opts: { range?: string; json?: boolean; why?: boolean }) => {
    process.exitCode = await runTriage(opts);
  });
program
  .command("gate")
  .description("run the verification gate over a diff")
  .option("--range <range>", "git diff range", "HEAD")
  .option("--tier <tier>", "provisional triage tier override")
  .option("--json", "print the verdict as JSON")
  .option("--no-lens", "skip llm checks (fast and free; for the pre-push hook)")
  .option("--fast", "run only the checks that do not declare themselves slow")
  .option("--no-emit", "do not record signals; for verifying the gate itself")
  .action(async (opts: { range?: string; tier?: string; json?: boolean; lens?: boolean; emit?: boolean; fast?: boolean }) => {
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
      ...(opts.emit === false ? { noEmit: true } : {}),
      ...(opts.fast === true ? { fast: true } : {}),
    });
  });

program
  .command("retro")
  .description("cluster new signals and propose rule changes (human-gated, never applied)")
  .option("--dry-run", "cluster only: no LLM calls, nothing written")
  .option("--model <model>", "model for the proposal step")
  .option("--json", "the proposals as data, for the agent that presents them")
  .action(async (opts: { dryRun?: boolean; model?: "haiku" | "sonnet" | "opus"; json?: boolean }) => {
    process.exitCode = await runRetro(opts);
  });

// The human gate for a memory write, discharged by the human typing this. Every
// other route into `signals.jsonl` is the engine recording what it observed.
program
  .command("signal")
  .argument("<type>", "kebab-case type, e.g. triage-miss; the retro clusters on it")
  .argument("<detail...>", "one or two sentences a reader can reconstruct the event from")
  .description(`record an observation in ${DEFINITION_DIR}/memory/signals.jsonl (you are the human gate)`)
  // The defaults come from `commands/signal.ts` rather than being written out
  // again here: the help text and the fallback the command applies are the same
  // fact, and two copies of a fact drift.
  .option(
    "-p, --phase <phase>",
    "where it happened: init, plan, apply, verify, review, …",
    DEFAULT_PHASE,
  )
  .option("-s, --severity <severity>", "low | medium | high", DEFAULT_SEVERITY)
  // NOT variadic, and repeatable instead. A variadic option next to a variadic
  // `<detail...>` argument eats the rest of the sentence: `--rule skills/x.md
  // mis-triaged an auth change` stored four words as rules and truncated the
  // observation, in an APPEND-ONLY file that may not be edited to fix it.
  .option(
    "-r, --rule <path>",
    "skill file this implicates, e.g. skills/recording.md; repeat for more",
    (value: string, previous: string[] | undefined) => [...(previous ?? []), value],
  )
  .option("--dry-run", "print the line that would be appended, write nothing")
  .action(
    async (
      type: string,
      detail: string[],
      // `phase` and `severity` are not optional: Commander always supplies the
      // defaults above, so a conditional spread would be a branch that never takes
      // its second path.
      opts: { phase: string; severity: string; rule?: string[]; dryRun?: boolean },
    ) => {
      process.exitCode = await runSignal({
        type,
        detail: detail.join(" "),
        phase: opts.phase,
        severity: opts.severity,
        rule: opts.rule ?? [],
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      });
    },
  );

program
  .command("opinion")
  .argument("[id]", "which opinion to run; omit for the list and what earned each")
  .description("run a rule Whetstone offers that no repo declares")
  .action(async (id: string | undefined) => {
    process.exitCode = await runOpinion(id);
  });

program
  .command("update")
  .description("what changed since init wrote this repo: reports, never writes")
  .option("--json", "print the verdicts as JSON")
  .action(async (opts: { json?: boolean }) => {
    process.exitCode = await runUpdate({ ...(opts.json !== undefined ? { json: opts.json } : {}) });
  });

program
  .command("init")
  .description(`interview this repo and generate its ${DEFINITION_DIR}/`)
  .option("--answers <file>", "JSON file of interview answers")
  .option("--purpose <text>", "one-line project purpose")
  .option("--risk <flags>", "comma-separated: money,personalData,productionData,authn,safetyCritical")
  .option("--source <glob...>", "where this project's code lives: scopes the checks and the triage rules")
  .option("--strict <glob:reason...>", "a strict path and why it earns full TDD")
  .option("--stack <text>", "what the project is built with, for the constitution")
  .option("--propose", "draft the answers with the judge: you edit and sign (one model call)")
  .option("--out <file>", "where --propose writes its draft (default .wst-answers.json)")
  .option("--llm", "also seed an uncalibrated review lens (capped at warn)")
  .option("--definitions-only", `write ${DEFINITION_DIR}/ and nothing else: no AGENTS.md, no CLAUDE.md`)
  .option("--force", "overwrite existing files, listing them first")
  .option("--dry-run", "show the plan, write nothing")
  .option("--json", "print the plan as JSON")
  .action(async (opts: Parameters<typeof runInit>[0]) => {
    process.exitCode = await runInit(opts);
  });


// A misconfigured repo gets a sentence, not a stack. Anything else keeps its
// trace: an unexpected throw is a bug in Whetstone and the trace is the report.
try {
  await program.parseAsync(process.argv);
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!message.startsWith("wst.yaml:")) throw cause;
  console.error(message);
  process.exitCode = 2;
}
