/**
 * Findings from a tool that is not Whetstone, on their way into the log. PURE.
 *
 * Of 61 signals here, 45 predate the `source` field and 6 were written by the
 * gate. The rest were typed. Anything that needs remembering gets forgotten,
 * so a reviewer, a linter or another agent should be able to hand over what it
 * found without a human retyping it.
 *
 * The human gate does not move: this reads and validates, and a person still
 * runs the command that appends.
 */

import { humanSignal, type HumanObservation } from "./human.js";

export type ForeignRead =
  | { readonly ok: true; readonly findings: readonly HumanObservation[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Keys a tool might put its list under. */
const LIST_KEYS = ["findings", "results", "issues", "signals", "observations"];

function entriesIn(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === "object") {
      for (const key of LIST_KEYS) {
        const nested = (parsed as Record<string, unknown>)[key];
        if (Array.isArray(nested)) return nested;
      }
      return [parsed];
    }
    return null;
  } catch {
    // Not one document. NDJSON is what an event stream emits.
  }

  const lines = trimmed.split("\n").filter((l) => l.trim() !== "");
  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return out.length > 0 ? out : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function readForeignFindings(text: string, tool?: string): ForeignRead {
  const entries = entriesIn(text);
  if (entries === null) return { ok: false, errors: ["not JSON, and not one JSON object per line"] };
  if (entries.length === 0) return { ok: false, errors: ["no findings in it, which is not a signal"] };

  const findings: HumanObservation[] = [];
  const errors: string[] = [];

  entries.forEach((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const rules = e["rule_affected"] ?? e["ruleAffected"];
    const detail = str(e["detail"]);

    const observation: HumanObservation = {
      type: str(e["type"]),
      phase: str(e["phase"]),
      severity: str(e["severity"]),
      // Named in the record, because a finding nobody can trace back to its
      // source is one nobody can re-run.
      detail: tool === undefined ? detail : `${detail} (reported by ${tool})`,
      ruleAffected: Array.isArray(rules) ? rules.filter((r): r is string => typeof r === "string") : [],
      branch: null,
      // NEVER true. A tool found these; the human ran the command that filed
      // them, which is `cli` and not `human` in the record.
      attested: false,
    };

    const checked = humanSignal(observation, new Date(0));
    if (checked.ok) findings.push(observation);
    else for (const problem of checked.errors) errors.push(`finding ${String(i + 1)}: ${problem}`);
  });

  // ALL OR NOTHING. The log is append-only, so half a batch written is a record
  // nobody can reconcile and the fix cannot be an edit.
  return errors.length > 0 ? { ok: false, errors } : { ok: true, findings };
}
