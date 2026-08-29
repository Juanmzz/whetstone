/**
 * Editing `.wst/wst.yaml` in place. PURE.
 *
 * Surgical rather than a re-render: `renderWstYaml` hardcodes `agent: claude`
 * and knows only the keys `init` writes, so re-rendering a hand-extended file
 * would drop what it does not know and silently reset what it does.
 */

import type { Agent } from "./schema.js";

export interface ConfigEdit {
  readonly agent?: Agent;
  /** The full active set. Anything absent is commented out, never deleted. */
  readonly skills?: readonly string[];
}

const AGENT_LINE = /^(agent:\s*)(\S+)(.*)$/;
const SKILL_LINE = /^(\s*)(#\s*)?-\s*(skills\/\S+)\s*$/;

export function editConfig(text: string, edit: ConfigEdit): string {
  const lines = text.split("\n");
  const out = edit.agent === undefined ? lines : withAgent(lines, edit.agent);
  return (edit.skills === undefined ? out : withSkills(out, edit.skills)).join("\n");
}

function withAgent(lines: readonly string[], agent: Agent): string[] {
  let found = false;
  const out = lines.map((line) => {
    const m = AGENT_LINE.exec(line);
    if (m === null) return line;
    found = true;
    return `${m[1]}${agent}${m[3]}`;
  });
  if (found) return out;

  // ADDED, not refused (adr-0042). Under `version:` where `init` writes it, or at
  // the top: both are the top level, which is the placement the refusal guarded.
  const at = out.findIndex((line) => /^version:/.test(line));
  const added = `agent: ${agent.padEnd(18)} # which adapter runs llm checks`;
  return at < 0 ? [added, ...out] : [...out.slice(0, at + 1), added, ...out.slice(at + 1)];
}

function withSkills(lines: readonly string[], active: readonly string[]): string[] {
  const wanted = new Set(active);
  const seen = new Set<string>();

  const out = lines.map((line) => {
    const m = SKILL_LINE.exec(line);
    if (m === null) return line;
    const [, indent = "", , skill = ""] = m;
    seen.add(skill);
    const bare = indent.replace(/^ {2}/, "  ");
    return wanted.has(skill) ? `${bare}- ${skill}` : `${bare}# - ${skill}`;
  });

  const missing = active.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    throw new Error(
      `wst.yaml has no line for ${missing.join(", ")}: a skill is activated by uncommenting ` +
        `the line already there, so one that was never written cannot be switched on`,
    );
  }
  return out;
}
