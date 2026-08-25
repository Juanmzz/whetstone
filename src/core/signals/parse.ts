/**
 * The ONE parser for `signals.jsonl`. PURE — text in, records out.
 */

import type { SignalSeverity } from "./emit.js";

/**
 * One entry of the log. The six required fields are exactly what every one of the
 * 30 accumulated entries carries and what `appendSignals` writes, so requiring them
 * rejects nothing real (measured over the full log — `test/signal-log.test.ts`).
 * They are also what the consumers silently assume: `cluster` keys on `id` and
 * branches on `severity`, `nextId` derives the next id from `id`. A line missing one
 * does not read as bad data, it reads as *absent* data, which is the failure mode
 * this parser exists to make impossible.
 *
 * `fingerprint`, `source`, `rule_affected` and `resolved_by` stay optional: the
 * hand-written entries predate them and the machine-written ones do not always
 * carry `resolved_by`.
 */
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
  /**
   * The branch the signal was observed on — the unit of work.
   *
   * Optional because the 45 entries written before the field have none, and
   * because a detached HEAD has no honest answer. Absent means unknown; it is
   * never written as `null`, which would read as present-and-empty.
   */
  readonly branch?: string;
}

export class SignalLogParseError extends Error {
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;

  constructor(line: number, why: string) {
    super(`signals.jsonl:${line} ${why}: fix line ${line} before running again`);
    this.name = "SignalLogParseError";
    this.line = line;
  }
}

const SEVERITIES: readonly string[] = ["low", "medium", "high"];
const REQUIRED = ["id", "ts", "type", "phase", "severity", "detail"] as const;

function validate(value: unknown, line: number): SignalRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // `42` and `"x"` and `null` are all valid JSON. Accepting them would put a
    // record in the log that answers `undefined` to every question asked of it —
    // indistinguishable, downstream, from a signal that was never written.
    throw new SignalLogParseError(line, "is valid JSON but not an object");
  }
  const record = value as Record<string, unknown>;

  for (const field of REQUIRED) {
    if (typeof record[field] !== "string") {
      throw new SignalLogParseError(line, `is missing a string \`${field}\``);
    }
  }
  // Checked where the other optional fields are not, and the asymmetry is
  // deliberate: `branch` is new, so no accumulated line can break on it, and it is
  // a GROUPING KEY. A `branch` of `42` would open a cluster nobody can name and
  // nobody can trace back to a piece of work.
  if (record["branch"] !== undefined && typeof record["branch"] !== "string") {
    throw new SignalLogParseError(line, "has a `branch` that is not a string");
  }
  if (!SEVERITIES.includes(record["severity"] as string)) {
    throw new SignalLogParseError(
      line,
      `has severity "${String(record["severity"])}", not one of ${SEVERITIES.join("/")}`,
    );
  }
  return record as unknown as SignalRecord;
}

/**
 * Blank lines are skipped, everything else must parse. A trailing newline is how
 * `appendSignals` writes the file, so tolerating it is required, not lenient.
 */
export function parseSignalLog(text: string): SignalRecord[] {
  const out: SignalRecord[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new SignalLogParseError(i + 1, "is not valid JSON");
    }
    out.push(validate(value, i + 1));
  }
  return out;
}
