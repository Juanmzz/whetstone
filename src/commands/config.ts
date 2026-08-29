/**
 * `wst config`: edit `.wst/wst.yaml` without opening it.
 *
 * The judge key has meant something since adr-0026 and the only way to set it
 * was a text editor, so the second adapter was reachable in principle and not
 * in practice.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MARK, MARK_ENTRANCE } from "../banner.js";
import { renderMark } from "../core/tui/mark.js";
import { colorDepth } from "../shell/color.js";
import { honingFrames } from "../core/tui/honing.js";
import { editConfig } from "../core/config/edit.js";
import { parseConfig } from "../core/config/schema.js";
import { summaryOf } from "../core/config/skills.js";
import { DEFINITION_DIR } from "../core/paths.js";
import { initialState, press, render, type SkillState } from "../core/tui/model.js";
import { CONFIG_FILE } from "../shell/config.js";
import { createGitAdapter } from "../shell/git.js";
import { paint, play, rawKeys, restore } from "../shell/tui.js";
import { parse as parseYaml } from "yaml";

/**
 * Every skill the config mentions, active or commented out, each carrying the
 * line its own file says about it.
 *
 * A skill whose file is missing gets an empty summary rather than being dropped:
 * it is listed in `wst.yaml`, and hiding it here would hide the reason the
 * emitter is about to fail.
 */
async function skillsIn(
  text: string,
  active: readonly string[],
  definitionRoot: string,
): Promise<readonly SkillState[]> {
  const on = new Set(active);
  const ids: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:#\s*)?-\s*(skills\/\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined) ids.push(m[1]);
  }

  return Promise.all(
    ids.map(async (id) => ({
      id,
      active: on.has(id),
      summary: summaryOf(await readFile(join(definitionRoot, id), "utf-8").catch(() => "")),
    })),
  );
}

export interface ConfigOptions {
  /**
   * Whether to play the entrance. False when something already did: reaching
   * this from the home screen would otherwise cost a second skip for one open.
   */
  readonly entrance?: boolean;
}

export async function runConfig(cwd: string, opts: ConfigOptions = {}): Promise<number> {
  const root = await createGitAdapter(cwd).repoRoot();
  if (root === null) {
    console.error("not inside a git repository; wst.yaml lives in one, so it needs one");
    return 1;
  }

  const path = join(root, DEFINITION_DIR, CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    console.error(`no ${DEFINITION_DIR}/${CONFIG_FILE}; run \`wst init\` first`);
    return 1;
  }

  const raw: unknown = parseYaml(text);
  const config = parseConfig(raw);
  const declared = (raw as { skills?: unknown }).skills;
  const active = Array.isArray(declared) ? declared.filter((s) => typeof s === "string") : [];

  let state = initialState({
    agent: config.agent,
    skills: await skillsIn(text, active, dirname(path)),
  });

  if (!process.stdin.isTTY) {
    // Printing the screen is the honest degradation: it says what the settings
    // are, and says why it cannot take a keypress.
    console.log(render(state).slice(0, -2).join("\n"));
    console.error("\nnot a terminal, so nothing can be selected. Edit the file directly.");
    return 1;
  }

  const keys = rawKeys(process.stdin, () => {
    keys.close();
    restore(process.stdout);
    process.exit(130);
  });

  try {
    const depth = colorDepth(process.stdout.isTTY === true, process.env);
    const mark = renderMark(MARK, depth);
    if (opts.entrance !== false) {
      await play(process.stdout, keys, honingFrames(MARK_ENTRANCE).map((f) => renderMark(f, depth)));
    }

    for (;;) {
      // Menu only: the skills list plus the mark is exactly a default terminal.
      const screen = render(state);
      paint(process.stdout, state.view.kind === "menu" ? [...mark, ...screen] : screen);
      const result = press(state, await keys.next());
      state = result.state;

      if (result.action.kind === "quit") return 0;
      if (result.action.kind === "save") {
        // `text` is REPLACED, not kept. Each edit is applied to what the file
        // says now, so the second toggle of a session does not rewrite over the
        // first one from a copy taken before it.
        // Caught: a throw escapes a raw-mode menu as a stack trace, and at that
        // point nothing has restored the terminal.
        try {
          text = editConfig(text, { agent: result.action.agent, skills: result.action.skills });
          await writeFile(path, text, "utf-8");
        } catch (cause) {
          state = { ...state, wrote: `NOT written: ${(cause as Error).message}` };
        }
      }
    }
  } finally {
    keys.close();
    restore(process.stdout);
  }
}
