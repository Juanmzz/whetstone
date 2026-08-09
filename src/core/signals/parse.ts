/**
 * The ONE parser for `signals.jsonl`. PURE — text in, records out.
 *
 * RED STUB — deliberately carries the lenient behaviour this change exists to
 * delete, so the failing test fails on an assertion rather than a missing module.
 */

import type { SignalSeverity } from "./emit.js";

export interface SignalRecord {
  readonly id: string;
  readonly ts: string;
  readonly type: string;
  readonly phase: string;
  readonly severity: SignalSeverity;
  readonly detail: string;
  readonly rule_affected?: readonly string[];
  readonly resolved_by?: string;
  readonly fingerprint?: string;
  readonly source?: string;
}

export function parseSignalLog(text: string): SignalRecord[] {
  const out: SignalRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as SignalRecord);
    } catch {
      // skipped
    }
  }
  return out;
}
