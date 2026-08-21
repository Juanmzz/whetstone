/**
 * The one place that decides which judge runs.
 *
 * `createClaudeJudge()` used to be called at five composition roots, so the
 * vendor was hardcoded five times while `architecture.md` claimed an `agent:`
 * key selected it. The key now exists and this reads it.
 */

import type { WstConfig } from "../core/config/schema.js";
import type { LlmJudge } from "../core/ports.js";
import { createClaudeJudge } from "./claude.js";
import { createGeminiJudge } from "./gemini.js";
import { loadConfig } from "./config.js";

/** The adapter the config asks for. */
export function judgeFor(config: WstConfig): LlmJudge {
  switch (config.agent) {
    case "claude":
      return createClaudeJudge();
    case "gemini":
      return createGeminiJudge();
  }
}

/** Read the config and build the judge. What a composition root wants. */
export async function resolveJudge(definitionRoot: string): Promise<LlmJudge> {
  return judgeFor(await loadConfig(definitionRoot));
}
