/**
 * The one place that decides which judge runs.
 *
 * `createClaudeJudge()` used to be called at five composition roots, so the
 * vendor was hardcoded five times while `architecture.md` claimed an `agent:`
 * key selected it. The key now exists and this reads it.
 */

import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, parseConfig, type WstConfig } from "../core/config/schema.js";
import type { LlmJudge } from "../core/ports.js";
import { createClaudeJudge } from "./claude.js";

export const CONFIG_FILE = "wst.yaml";

/**
 * `.wst/wst.yaml`, or the defaults when it is absent or unreadable.
 *
 * Absent is normal — every repo has none until `init` runs. A file that IS
 * there and declares something unrunnable throws, because that is a request the
 * tool cannot honour and honouring it silently is the failure the key prevents.
 */
export async function loadConfig(definitionRoot: string): Promise<WstConfig> {
  let text: string;
  try {
    text = await readFile(join(definitionRoot, CONFIG_FILE), "utf-8");
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(parseYaml(text));
}

/** The adapter the config asks for. */
export function judgeFor(config: WstConfig): LlmJudge {
  switch (config.agent) {
    case "claude":
      return createClaudeJudge();
  }
}

/** Read the config and build the judge. What a composition root wants. */
export async function resolveJudge(definitionRoot: string): Promise<LlmJudge> {
  return judgeFor(await loadConfig(definitionRoot));
}
