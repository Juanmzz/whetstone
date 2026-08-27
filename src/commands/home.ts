/**
 * Bare `wst`: the screen, and then the command it picked.
 *
 * The pick runs AFTER this returns to a normal terminal, not inside the raw-mode
 * loop. Every command stays exactly what it was on a command line — `gate` still
 * prints a report you can pipe, `init` still opens its own interview — and this
 * is only the thing that chose one.
 */

import { MARK } from "../banner.js";
import { honingFrames } from "../core/tui/honing.js";
import { openHome, pressHome, renderHome, type HomeCommand } from "../core/tui/home.js";
import { clear, paint, play, rawKeys, restore } from "../shell/tui.js";
import { runCheck } from "./check.js";
import { runConfig } from "./config.js";
import { runGate } from "./gate.js";
import { runInit } from "./init.js";
import { runRetro } from "./retro.js";
import { gatherStatus, runStatus } from "./status.js";
import { runTriage } from "./triage.js";
import { runUpdate } from "./update.js";

/** Defaults everywhere: the screen picks a command, never its flags. */
const RUN: Readonly<Record<HomeCommand, (cwd: string) => Promise<number>>> = {
  status: (cwd) => runStatus(cwd),
  init: (cwd) => runInit({}, cwd),
  gate: (cwd) => runGate({}, cwd),
  triage: (cwd) => runTriage({}, cwd),
  check: (cwd) => runCheck({}, cwd),
  config: (cwd) => runConfig(cwd, { entrance: false }),
  update: (cwd) => runUpdate({}, cwd),
  retro: (cwd) => runRetro({}, cwd),
};

export async function runHome(cwd: string = process.cwd()): Promise<number> {
  const report = await gatherStatus(cwd);
  let state = openHome(report);

  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });

  let picked: HomeCommand | null = null;
  try {
    await play(process.stdout, keys, honingFrames(MARK));

    for (;;) {
      paint(process.stdout, [...MARK, "", ...renderHome(state)]);
      const result = pressHome(state, await keys.next());
      state = result.state;

      if (result.action.kind === "quit") break;
      if (result.action.kind === "run") {
        picked = result.action.command;
        break;
      }
    }
  } finally {
    // Released BEFORE the command runs: `init` and `config` open readers of their
    // own, and two raw-mode readers on one stdin split the keystrokes between them.
    keys.close();
    restore(process.stdout);
  }

  if (picked === null) return 0;

  // Cleared, so the command's own output is the whole screen rather than the
  // menu with a report appended under it. Not `paint`: that hides the cursor,
  // and what runs next owns the terminal.
  clear(process.stdout);
  return RUN[picked](cwd);
}
