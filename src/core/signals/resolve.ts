/**
 * Recording that a signal was ANSWERED. PURE — log text in, log text out.
 *
 * The one write that touches a stored line. [RC6] makes the log append-only for
 * CORRECTIONS, and `resolved_by` corrects nothing: it says what later answered
 * the signal, a fact that did not exist when the line was written. The memory
 * README `wst init` ships carves the field out by name, and the 27 entries that
 * carry it were set this way by hand. Set ONCE — overwriting an answer would be
 * a correction, so it is refused here rather than left to a caller to remember.
 */

import { parseSignalLog } from "./parse.js";

export type Resolution =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/**
 * @param by an amendment (`skills/voice.md@v3`), a decision, a PR. Free text,
 *   because what closes a signal is not one shape.
 *
 * THROWS on a log that does not parse: a file with one unreadable line is not a
 * file to rewrite.
 */
export function markResolved(text: string, id: string, by: string): Resolution {
  const answer = by.trim();
  if (answer === "") {
    return { ok: false, error: "no answer given: `--by` is what the record would say" };
  }

  const records = parseSignalLog(text);
  const known = records.find((r) => r.id === id);
  if (known === undefined) {
    return { ok: false, error: `no signal \`${id}\` in the log` };
  }
  if (known.resolved_by !== undefined) {
    return {
      ok: false,
      error:
        `\`${id}\` already records \`${known.resolved_by}\` as what answered it. ` +
        `Changing that is a correction, and [RC6] makes a correction a NEW entry ` +
        `carrying \`supersedes\`.`,
    };
  }

  // Only the one line is rewritten: the other 60 are evidence, and a diff that
  // re-serialises them invites the question of what else moved. The spread keeps
  // the field order the line was written in.
  const lines = text.split("\n");
  const at = lines.findIndex((line) => {
    if (line.trim() === "") return false;
    return (JSON.parse(line) as { id?: unknown }).id === id;
  });
  lines[at] = JSON.stringify({
    ...(JSON.parse(lines[at] as string) as Record<string, unknown>),
    resolved_by: answer,
  });
  return { ok: true, text: lines.join("\n") };
}
