/**
 * Rendering a run out of the log. PURE.
 *
 * The same job `core/gate/report.ts` has, one layer later and with the same rule:
 * *never let a reader conclude "verified" from something that was not.* A gate run
 * has three endings that must not share a word; the log makes it FIVE, because a
 * run can also break outright, or stop without writing an ending at all:
 *
 *   passed          a verdict was reached, and it was yes
 *   BLOCKED         a verdict was reached, and it was no
 *   INCOMPLETE      the run exited 2 — something that could have blocked never ran
 *   FAILED          the gate itself broke; there is no verdict here
 *   NO END RECORDED nothing was written; the run is going, or it died
 *
 * The last two are the reason this file reads `exit` instead of trusting `detail`.
 * The live log is full of lines like `{"kind":"run-finished","detail":"passed — 0
 * check(s), 0 errored","status":"pass","exit":2}`: the gate's own wording is about
 * the verdict OBJECT, which really did not block, while exit 2 is `EXIT_INCOMPLETE`
 * and means nothing about the change was verified. Echoing the word "passed" there
 * would reproduce, in a new command, precisely the confusion hard rule 3 exists to
 * stop.
 */

import { EXIT_BLOCKED, EXIT_INCOMPLETE, EXIT_PASS } from "../gate/report.js";
import type { RunEnding, RunSummary, TimelineEntry } from "./timeline.js";

/**
 * Why the exit codes are IMPORTED rather than restated.
 *
 * `exit` on a terminal line is the process exit code, and `core/gate/report.ts`
 * owns what those numbers mean. A second copy of that mapping would be a fact
 * stored twice, and this reader would go on saying "passed" for a code the gate had
 * since redefined.
 */
const EXIT_MEANINGS = { pass: EXIT_PASS, blocked: EXIT_BLOCKED, incomplete: EXIT_INCOMPLETE };

/**
 * What the ending MEANS, as opposed to what its line happens to say.
 *
 * Exported because `--json` publishes it. A caller handed `status: "pass"` next to
 * `exit: 2` and left to work it out will conclude the run passed — the same wrong
 * conclusion this file exists to prevent, in a machine-readable form.
 */
export type Reading = "passed" | "blocked" | "incomplete" | "failed" | "unreadable" | "unterminated";

export function runReading(ending: RunEnding): Reading {
  if (ending.kind === "unterminated") return "unterminated";
  if (ending.kind === "failed") return "failed";
  // `status` decides only when there is no exit code to ask. A verdict of `block`
  // always reads as blocked; a verdict of `pass` never, on its own, reads as passed.
  if (ending.exit === null) return ending.status === "block" ? "blocked" : "unreadable";
  if (ending.exit === EXIT_MEANINGS.pass) return "passed";
  if (ending.exit === EXIT_MEANINGS.blocked) return "blocked";
  if (ending.exit === EXIT_MEANINGS.incomplete) return "incomplete";
  return "unreadable";
}

/**
 * The word on the terminal line itself, so a `run-failed` is never mistakable for a
 * `run-finished` while scanning the column. Capitals mark the four readings that
 * are not a clean pass, the same convention `renderGateRun` uses for `FAIL`.
 */
function readingLabel(reading: Reading): string {
  switch (reading) {
    case "passed":
      return "passed";
    case "blocked":
      return "BLOCKED";
    case "incomplete":
      return "INCOMPLETE";
    case "failed":
      return "FAILED";
    case "unreadable":
      return "ended";
    case "unterminated":
      return "NO END RECORDED";
  }
}

/** `2026-08-12T18:42:21.186Z` → `2026-08-12 18:42:21Z`. Left alone if it will not parse. */
function shortTime(ts: string): string {
  return Number.isNaN(Date.parse(ts)) ? ts : ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function duration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `null` prints as `?`, never as `NaN` — a NaN reads like a measurement. */
function offset(ms: number | null): string {
  return (ms === null ? "?" : `+${(ms / 1000).toFixed(3)}s`).padStart(10);
}

/** Continuation lines of a multi-line detail, lined up under the first. */
function indented(detail: string, pad: number): string[] {
  const [first = "", ...rest] = detail.split("\n");
  return [first, ...rest.map((line) => `${" ".repeat(pad)}${line}`)];
}

const LABEL_WIDTH = 16;

/**
 * One event, as one or more lines.
 *
 * Exported because `--follow` prints these one at a time as they land, while the
 * one-shot read prints all of them at once. Two rendering paths over one record is
 * where output starts to disagree with itself, so both go through this.
 */
export function renderEntryLines(entry: TimelineEntry, ending: RunEnding): string[] {
  const { event } = entry;
  const label = (text: string): string => `  ${offset(entry.offsetMs)}  ${text.padEnd(LABEL_WIDTH)}`;
  const pad = 2 + 10 + 2 + LABEL_WIDTH;

  if (event.kind === "check-finished" && event.check !== undefined) {
    // Columns, because "which check took how long" is the question a run's shape is
    // read for, and it is not answerable from prose that varies in length.
    const status = (event.status ?? "—").padEnd(9);
    return [`${label("check")}${event.check.padEnd(14)}${status}${duration(event.ms ?? null).padStart(8)}`];
  }

  const kindLabel =
    event.kind === "run-started"
      ? "started"
      : event.kind === "triage-classified"
        ? "triage"
        : event.kind === "check-skipped"
          ? "skipped"
          : // The terminal line carries the reading, not the kind: `finished` next to
            // an exit of 2 is how a reader talks themselves into "it passed".
            readingLabel(runReading(ending));

  // The detail VERBATIM (bar the backticks the log writes for a terminal). This is a
  // reader; it does not rewrite what was recorded. What it may not do is draw a
  // conclusion the record does not support, which is what the label above is for.
  const [head = "", ...rest] = indented(event.detail.replaceAll("`", ""), pad);
  return [`${label(kindLabel)}${head}`, ...rest];
}

function endingSentence(summary: RunSummary): string {
  const reading = runReading(summary.ending);
  const took = summary.durationMs === null ? "" : `, ${duration(summary.durationMs)} wall`;
  const exit =
    summary.ending.kind === "unterminated" || summary.ending.exit === null
      ? null
      : summary.ending.exit;
  const code = exit === null ? "" : ` (exit ${exit})`;

  switch (reading) {
    case "passed":
      return `passed${code}${took}`;
    case "blocked":
      return `BLOCKED${code}${took} — ${summary.ending.kind === "unterminated" ? "" : summary.ending.detail}`;
    case "incomplete":
      // Deliberately not "passed with warnings". Exit 2 is `EXIT_INCOMPLETE`: either
      // a blocking check errored, or nothing applied at all. Both mean the change
      // was not verified, and the gate's own report says so in words.
      return (
        `INCOMPLETE${code}${took} — the gate did not verify this change: either a check ` +
        `that can block never ran, or nothing applied to it`
      );
    case "failed":
      return (
        `FAILED${code}${took} — the run broke before it reached a verdict, so this is ` +
        `not a verdict on the change`
      );
    case "unreadable":
      return `ended${took} — the terminal line records no exit code, so this cannot say what the run concluded`;
    case "unterminated":
      return (
        `NO END RECORDED — this run wrote neither a finish nor a failure. It is either ` +
        `still running or it died without saying so; nothing here says it passed`
      );
  }
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The banner and the run's identity. Printed once, before anything is streamed.
 *
 * `following` drops the event count. Tailing prints the header before the run is
 * over, so the count is a snapshot that is wrong by the time the next line lands —
 * the first live tail said "1 events" and then streamed three more under it.
 */
export function renderRunHeader(
  summary: RunSummary,
  options: { readonly following?: boolean } = {},
): string {
  const tail =
    options.following === true
      ? "following — ^C to stop"
      : plural(summary.eventCount, "event");
  return [
    "whetstone — events",
    "",
    `  ${summary.run}   started ${shortTime(summary.startedAt)}   ${tail}`,
    "",
  ].join("\n");
}

/** The verdict paragraph. Printed last, whether the run was tailed or read back. */
export function renderRunEnding(summary: RunSummary): string[] {
  const lines = ["", `  ${endingSentence(summary)}`];
  if (summary.ending.kind === "unterminated") {
    // The only fact available about a run that never ended: when it was last heard
    // from. Everything else — still going, killed, hung — would be a guess.
    const last = summary.events.at(-1);
    if (last !== undefined) lines.push(`  last event: ${shortTime(last.event.ts)}`);
  }
  return lines;
}

export function renderRunTimeline(summary: RunSummary): string {
  return [
    renderRunHeader(summary),
    ...summary.events.flatMap((entry) => renderEntryLines(entry, summary.ending)),
    ...renderRunEnding(summary),
  ].join("\n");
}

/** The one-line form. Same words as the timeline's ending, so the two never disagree. */
function listEnding(summary: RunSummary): string {
  const reading = runReading(summary.ending);
  const label = readingLabel(reading);
  if (reading === "passed" || reading === "unterminated") return label;
  const exit =
    summary.ending.kind === "unterminated" || summary.ending.exit === null
      ? null
      : summary.ending.exit;
  return exit === null ? label : `${label} (exit ${exit})`;
}

export function renderRunList(summaries: readonly RunSummary[]): string {
  const lines = [
    "whetstone — events",
    "",
    `  ${plural(summaries.length, "run")} in the log, newest first`,
    "",
  ];
  for (const summary of summaries) {
    lines.push(
      `  ${summary.run.padEnd(14)}${shortTime(summary.startedAt).padEnd(23)}` +
        // Split so the number keeps its column and the noun still agrees with it.
        `${String(summary.eventCount).padStart(3)} ${(summary.eventCount === 1 ? "event" : "events").padEnd(6)}` +
        `${duration(summary.durationMs).padStart(9)}   ${listEnding(summary)}`,
    );
  }
  lines.push("", "  wst events --run <id> for one run's timeline");
  return lines.join("\n");
}

/**
 * An empty or absent log. NOT an error — it is what a repo that has not run the
 * gate looks like, and telling someone their log is broken when they simply have
 * not used the tool yet is how a diagnostic loses its credibility.
 *
 * The path is a PARAMETER because `core/` may not name the definition directory
 * (ADR-0012); the command joins it.
 */
export function noRunsMessage(logPath: string): string {
  return (
    "whetstone — events\n\n" +
    `  no runs recorded yet — nothing has been written to ${logPath}.\n` +
    "  `wst gate` appends to it as it runs."
  );
}
