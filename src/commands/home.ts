/**
 * Bare `wst`: the screen, the command it picked, and the screen again.
 *
 * The pick runs AFTER this returns to a normal terminal, and writes to that
 * terminal directly, so every command stays what it was on a command line
 * (adr-0032). This only chooses one.
 */

import { MARK_ENTRANCE, MARK_HOME } from "../banner.js";
import { honingFrames } from "../core/tui/honing.js";
import { renderMark } from "../core/tui/mark.js";
import { colorDepth } from "../shell/color.js";
import { openHome, pressHome, renderHome, type HomeCommand } from "../core/tui/home.js";
import { clear, paint, play, rawKeys, restore, type Keys } from "../shell/tui.js";
import { runCheck } from "./check.js";
import { runConfig } from "./config.js";
import { runGate } from "./gate.js";
import { runInit } from "./init.js";
import { runRetro } from "./retro.js";
import { runStatus } from "./status.js";
import { gatherStatus } from "../shell/status.js";
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

function openKeys(): Keys {
  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });
  return keys;
}

export async function runHome(cwd: string = process.cwd()): Promise<number> {
  let state = openHome(await gatherStatus(cwd));
  let keys = openKeys();

  // Read once: the terminal does not change depth mid-session, and re-deriving
  // it per frame would put an env lookup inside the animation loop.
  const depth = colorDepth(process.stdout.isTTY === true, process.env);
  const mark = renderMark(MARK_HOME, depth);

  try {
    await play(process.stdout, keys, honingFrames(MARK_ENTRANCE).map((f) => renderMark(f, depth)));

    for (;;) {
      // The mark plus the menu was EXACTLY a default terminal. Moving the name
      // out of the menu and beside the stone gave one of those rows back.
      paint(process.stdout, [...mark, ...renderHome(state)]);
      const result = pressHome(state, await keys.next());
      state = result.state;

      if (result.action.kind === "quit") return 0;
      if (result.action.kind !== "run") continue;

      // `init` and `config` open readers of their own, and two raw-mode readers
      // on one stdin split the keystrokes between them. `clear`, not `paint`:
      // paint hides the cursor, and what runs next owns the terminal.
      keys.close();
      restore(process.stdout);
      clear(process.stdout);

      const code = await RUN[result.action.command](cwd);

      process.stdout.write(`\n  ${result.action.command} exited ${String(code)} · any key for the menu\n`);
      keys = openKeys();
      await keys.next();

      // Re-read: `init` is the row that makes seven other rows available.
      state = openHome(await gatherStatus(cwd));
    }
  } finally {
    keys.close();
    restore(process.stdout);
  }
}
