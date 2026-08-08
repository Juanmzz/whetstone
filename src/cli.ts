#!/usr/bin/env node
/**
 * `wst` — wiring only. Every command delegates immediately to `src/commands/`;
 * no logic lives here, so the CLI surface stays swappable.
 */

import { Command } from "commander";
import { runStatus } from "./commands/status.js";

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

await program.parseAsync(process.argv);
