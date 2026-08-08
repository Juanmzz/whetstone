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
import { TIERS, type Tier } from "./core/checks/schema.js";

const program = new Command();

program
  .name("wst")
  .description("Whetstone — a self-sharpening standards layer for AI coding agents")
  .version("0.4.0-alpha");

program
  .command("status")
  .description("show repo, .sdd/ and judge-adapter health")
  .action(async () => {
    process.exitCode = await runStatus();
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

await program.parseAsync(process.argv);
