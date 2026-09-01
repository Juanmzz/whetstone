/**
 * Which agent harnesses this repo is for, and what that decides. PURE.
 *
 * TWO decisions, and `init` used to make neither. It wrote `GEMINI.md` into a
 * repo whose owner uses Claude. They are not the same list:
 *
 * - which harnesses read this repo, which decides the pointer files
 * - which of those can run an `llm` check, which needs an adapter to exist
 *
 * `AGENTS.md` is written either way. It is the source (ADR-0002); a pointer is a
 * one-line file for a harness that cannot find it on its own.
 */

import type { Agent } from "../config/schema.js";

export interface Harness {
  readonly id: string;
  /** What a human calls it on the screen. */
  readonly label: string;
  /** Finds `AGENTS.md` by itself, so a pointer would be a second file saying nothing. */
  readonly readsAgentsMd: boolean;
  /** The file that points it at `AGENTS.md`, where it needs one. */
  readonly pointer: string | null;
  /** The judge adapter, where one exists. Null means it cannot run an llm check. */
  readonly adapter: Agent | null;
}

export const HARNESSES: readonly Harness[] = Object.freeze([
  { id: "claude-code", label: "Claude Code", readsAgentsMd: false, pointer: "CLAUDE.md", adapter: "claude" },
  { id: "antigravity", label: "Antigravity / Gemini CLI", readsAgentsMd: false, pointer: "GEMINI.md", adapter: "antigravity" },
  { id: "codex", label: "Codex", readsAgentsMd: true, pointer: null, adapter: "codex" },
  { id: "opencode", label: "OpenCode", readsAgentsMd: true, pointer: null, adapter: null },
]);

const byId = new Map(HARNESSES.map((h) => [h.id, h]));

/** The one-line front doors, keyed by path. Empty when every pick reads `AGENTS.md`. */
export function pointersFor(picked: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of picked) {
    const pointer = byId.get(id)?.pointer;
    // NOT a copy of AGENTS.md: a pointer, so there is one source of truth.
    if (pointer !== null && pointer !== undefined) out[pointer] = "@AGENTS.md\n";
  }
  return out;
}

/**
 * The pointers for the harnesses a given judge belongs to.
 *
 * The fallback for an `init` that never asked which harnesses read the repo. It
 * used to write CLAUDE.md AND GEMINI.md unconditionally, so a repo whose judge is
 * claude was left carrying a front door for a harness nobody there runs.
 */
export function pointersForAgent(agent: Agent): Readonly<Record<string, string>> {
  return pointersFor(HARNESSES.filter((h) => h.adapter === agent).map((h) => h.id));
}

/** The first pick that can actually run a lens, or null when none can. */
export function judgeFor(picked: readonly string[]): Agent | null {
  for (const id of picked) {
    const adapter = byId.get(id)?.adapter;
    if (adapter !== null && adapter !== undefined) return adapter;
  }
  return null;
}
