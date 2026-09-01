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
import { runReady } from "./commands/ready.js";
import { runRetro } from "./commands/retro.js";
import { runSignal } from "./commands/signal.js";
import { DEFAULT_PHASE, DEFAULT_SEVERITY } from "./core/signals/human.js";
import { runInit } from "./commands/init.js";
import { runShippedCheck } from "./commands/run.js";
import { runHome } from "./commands/home.js";
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

const check = program
  .command("check")
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
  .argument("[id]", "which check Whetstone ships the logic for")
  .description("run a check whose logic ships with wst rather than with this repo")
  .action(async (id: string | undefined) => {
    process.exitCode = await runShippedCheck(id);
  });

program
  .command("triage")
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
  .command("ready")
  .description("is this task's work ready? resolves its own scope, no range needed")
  .option("--json", "the report as a JSON envelope, with a semantic `result` field")
  .option("--range <range>", "advanced: verify this range instead of the resolved scope")
  .option("--fast", "run only the checks that do not declare themselves slow")
  .option("--no-evidence", "no evidence store on this machine, so those checks cannot answer")
  .option("--lens", "run llm checks too; off by default")
  .action(async (opts: Parameters<typeof runReady>[0]) => {
    process.exitCode = await runReady(opts);
  });

program
  .command("gate")
  .description("compatibility: run the checks over a range. `ready` resolves its own")
  .option("--range <range>", "git diff range", "HEAD")
  .option("--tier <tier>", "provisional triage tier override")
  .option("--json", "print the verdict as JSON")
  .option("--no-lens", "skip llm checks (fast and free; for the pre-push hook)")
  .option("--no-evidence", "no evidence store on this machine, so those checks cannot answer")
  .option("--fast", "run only the checks that do not declare themselves slow")
  .option("--no-emit", "do not record signals; for verifying the gate itself")
  .action(async (opts: { range?: string; tier?: string; json?: boolean; lens?: boolean; evidence?: boolean; emit?: boolean; fast?: boolean }) => {
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
      ...(opts.emit === false ? { noEmit: true } : {}),
      ...(opts.fast === true ? { fast: true } : {}),
    });
  });

program
  .command("retro")
  .description("standby: cluster new signals and propose rule changes (human-gated)")
  .option("--dry-run", "cluster only: no LLM calls, nothing written")
  .option("--yes", "do not ask before spending: for a script, and for meaning it")
  .option("--model <model>", "model for the proposal step")
  .option("--json", "the proposals as data, for the agent that presents them")
  .action(async (opts: { dryRun?: boolean; yes?: boolean; model?: "haiku" | "sonnet" | "opus"; json?: boolean }) => {
    process.exitCode = await runRetro(opts);
  });

// The human gate for a memory write, discharged by the human typing this. Every
// other route into `signals.jsonl` is the engine recording what it observed.
program
  .command("signal")
  .argument("[type]", "kebab-case type, e.g. triage-miss; the retro clusters on it")
  .argument("[detail...]", "one or two sentences a reader can reconstruct the event from")
  .description(`standby: record an observation in ${DEFINITION_DIR}/memory/signals.jsonl (human-gated)`)
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
  // Two flags for one claim, and the command refuses either alone (adr-0035).
  .option("--quote <words>", "the human's OWN words, verbatim. Still needs a detail, and writes nothing without --confirmed")
  .option("--confirmed", "the human said yes to the quoted draft: writes it as `human-quoted`")
  .option(
    "--from-json <file>",
    "a batch of findings from another tool, or `-` for stdin. Records as `cli`",
  )
  .option("--tool <name>", "which tool found them, named in every record")
  .option("--resolve <id>", "record that a stored signal is answered, e.g. sig-b828c2b1")
  .option("--by <answer>", "what answered it: `skills/x.md@v3`, an adr, a PR. Required with --resolve")
  .action(
    async (
      type: string | undefined,
      detail: string[],
      // `phase` and `severity` are not optional: Commander always supplies the
      // defaults above, so a conditional spread would be a branch that never takes
      // its second path.
      opts: {
        phase: string;
        severity: string;
        rule?: string[];
        dryRun?: boolean;
        quote?: string;
        confirmed?: boolean;
        fromJson?: string;
        tool?: string;
        resolve?: string;
        by?: string;
      },
    ) => {
      process.exitCode = await runSignal({
        type: type ?? "",
        detail: detail.join(" "),
        phase: opts.phase,
        severity: opts.severity,
        rule: opts.rule ?? [],
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts.quote !== undefined ? { quote: opts.quote } : {}),
        ...(opts.confirmed !== undefined ? { confirmed: opts.confirmed } : {}),
        ...(opts.fromJson !== undefined ? { fromJson: opts.fromJson } : {}),
        ...(opts.tool !== undefined ? { tool: opts.tool } : {}),
        ...(opts.resolve !== undefined ? { resolve: opts.resolve } : {}),
        ...(opts.by !== undefined ? { by: opts.by } : {}),
      });
    },
  );

program
  .command("update")
  .description("standby: what changed since init wrote this repo. Reports, never writes")
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
  .option("--no-probe", "do not run this repo's own commands; every seeded check starts at warn")
  .option("--json", "print the plan as JSON")
  .action(async (opts: Parameters<typeof runInit>[0]) => {
    process.exitCode = await runInit(opts);
  });

/**
 * Bare `wst`, and only where somebody is looking at it.
 *
 * Off a terminal it prints the help it always printed. A menu needs a keypress,
 * and a program that waits for one in a pipe or a CI job is a program that hangs
 * where nobody can see it.
 */
program.action(async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    program.outputHelp();
    return;
  }
  process.exitCode = await runHome(process.cwd());
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
