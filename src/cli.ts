#!/usr/bin/env node
/**
 * `wst` — wiring only. Every command delegates immediately to `src/commands/`;
 * no logic lives here, so the CLI surface stays swappable.
 */

import { Command } from "commander";
import { runStatus } from "./commands/status.js";
import { runCheck } from "./commands/check.js";
import { runTriage } from "./commands/triage.js";
import { runGate } from "./commands/gate.js";
import { runRun } from "./commands/run.js";
import { runRetro } from "./commands/retro.js";
import { TIERS, type Tier } from "./core/checks/schema.js";

const program = new Command();

program
  .name("wst")
  .description("Whetstone — a self-sharpening standards layer for AI coding agents")
  .version("0.4.0-alpha");

program
  .command("status")
  .description("show repo, .sdd/ and judge-adapter health")
  .option("--quiet", "print only the final ready / NOT ready line")
  .action(async (opts: { quiet?: boolean }) => {
    process.exitCode = await runStatus(process.cwd(), { quiet: opts.quiet ?? false });
  });

program
  .command("check")
  .description("list the check registry from .sdd/checks/")
  .option("--json", "print the compiled index as JSON")
  .option("--compile", "write .sdd/checks/_index.json")
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
  .action(async (opts: { range?: string; tier?: string; json?: boolean }) => {
    // Validate rather than cast: an unrecognised --tier must be rejected loudly.
    // Silently coercing it would let `--tier=stict` run the gate at the wrong
    // discipline while reporting success.
    if (opts.tier !== undefined && !(TIERS as readonly string[]).includes(opts.tier)) {
      console.error(`unknown tier "${opts.tier}" — expected one of: ${TIERS.join(", ")}`);
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
    });
  });

program
  .command("run")
  .argument("<task...>", "what the crewmate should do")
  .description("dispatch a crewmate in an isolated worktree, then gate its work")
  .option("--dry-run", "print the charter and exit, spending nothing")
  .option("--lane <lane>", "scope the crewmate to a lane (boundary enforced by hook)")
  .option("--model <model>", "model for the crewmate")
  .option("--budget <usd>", "hard spend ceiling for the crewmate", "5")
  .option("--keep", "keep the worktree even when the gate passes")
  .action(
    async (
      task: string[],
      opts: { dryRun?: boolean; lane?: string; model?: string; budget?: string; keep?: boolean },
    ) => {
      process.exitCode = await runRun({
        task: task.join(" "),
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts.lane !== undefined ? { lane: opts.lane } : {}),
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.budget !== undefined ? { budgetUsd: Number(opts.budget) } : {}),
        ...(opts.keep !== undefined ? { keep: opts.keep } : {}),
      });
    },
  );

program
  .command("retro")
  .description("cluster new signals and propose rule changes (human-gated, never applied)")
  .option("--dry-run", "cluster only — no LLM calls, nothing written")
  .option("--model <model>", "model for the proposal step")
  .action(async (opts: { dryRun?: boolean; model?: "haiku" | "sonnet" | "opus" }) => {
    process.exitCode = await runRetro(opts);
  });

await program.parseAsync(process.argv);
