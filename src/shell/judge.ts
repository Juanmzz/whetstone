/**
 * The one place that decides which judge runs.
 *
 * `createClaudeJudge()` used to be called at five composition roots, so the
 * vendor was hardcoded five times while `architecture.md` claimed an `agent:`
 * key selected it. The key now exists and this reads it.
 */

import type { Agent, WstConfig } from "../core/config/schema.js";
import type { LlmJudge } from "../core/ports.js";
import { createClaudeJudge } from "./claude.js";
import { createAntigravityJudge } from "./antigravity.js";
import { createCodexJudge } from "./codex.js";
import { loadConfig } from "./config.js";

/** The adapter the config asks for. */
export function judgeFor(config: WstConfig): LlmJudge {
  switch (config.agent) {
    case "claude":
      return createClaudeJudge();
    case "antigravity":
      return createAntigravityJudge();
    case "codex":
      return createCodexJudge();
  }
}

/**
 * A resolver, not a judge: a check may name its own (adr-0026), and one that names
 * none gets the configured default. Adapters are built once and reused per agent —
 * two lenses on the same judge must not spawn two adapters.
 */
export async function resolveJudges(
  definitionRoot: string,
): Promise<(agent: Agent | undefined) => LlmJudge> {
  const config = await loadConfig(definitionRoot);
  const built = new Map<Agent, LlmJudge>();
  return (agent) => {
    const which = agent ?? config.agent;
    const existing = built.get(which);
    if (existing !== undefined) return existing;
    const made = judgeFor({ ...config, agent: which });
    built.set(which, made);
    return made;
  };
}

/** The configured judge, for the callers that have no check to ask about. */
export async function resolveJudge(definitionRoot: string): Promise<LlmJudge> {
  return (await resolveJudges(definitionRoot))(undefined);
}
