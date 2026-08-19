/**
 * The ONE parser for `events.jsonl`. PURE — text in, records out.
 */

import { isEventKind, type EventRecord } from "./record.js";

export class EventLogParseError extends Error {
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;

  constructor(line: number, why: string) {
    // Both forms on purpose: `events.jsonl:12` is what an editor jumps to, and the
    // prose names the line again for anything reading this as a sentence.
    super(`events.jsonl:${line} ${why} — nothing hand-edits this log, so line ${line} is a bug`);
    this.name = "EventLogParseError";
    this.line = line;
  }
}

const REQUIRED_STRINGS = ["run", "ts", "kind", "detail"] as const;

function validate(value: unknown, line: number): EventRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // Valid JSON that answers `undefined` to every question a consumer asks it —
    // indistinguishable, downstream, from a line nobody ever wrote.
    throw new EventLogParseError(line, "is valid JSON but not an object");
  }
  const record = value as Record<string, unknown>;

  for (const field of REQUIRED_STRINGS) {
    if (typeof record[field] !== "string") {
      throw new EventLogParseError(line, `is missing a string \`${field}\``);
    }
  }
  // A NUMBER, not merely present: `"3"` sorts before `"20"` as a string, which
  // silently reorders any run of ten or more events. Ordering is the whole reason
  // this field exists, so a `seq` that cannot order is worse than none.
  if (typeof record["seq"] !== "number" || !Number.isFinite(record["seq"])) {
    throw new EventLogParseError(line, "is missing a numeric `seq`");
  }
  if (!isEventKind(record["kind"])) {
    throw new EventLogParseError(
      line,
      `has kind "${String(record["kind"])}", which no reader knows how to interpret`,
    );
  }
  return record as unknown as EventRecord;
}

/**
 * Blank lines are skipped. A log with no trailing newline is tolerated because a
 * process killed mid-append leaves one, and surviving a crash is half of what this
 * primitive is for.
 */
export function parseEventLog(text: string): EventRecord[] {
  const out: EventRecord[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new EventLogParseError(i + 1, "is not valid JSON");
    }
    out.push(validate(value, i + 1));
  }
  return out;
}
