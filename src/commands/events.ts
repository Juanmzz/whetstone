/**
 * `wst events` — the composition root. Read the log, hand it to the pure core,
 * print. **No decisions are made here**: which lines belong to which run, what order
 * they happened in and how a run ended are all computed in `src/core/events/`, where
 * the tests can reach them.
 *
 * ADR-0011 built the log to pay three debts, the first being observability — *"what
 * is a dispatched agent doing right now"*. The log has been written since; nothing
 * read it. This command is the read.
 *
 * It writes NOTHING: no signal, no event, no receipt. Reading a log is not a run,
 * and a reader that logged would put its own activity into the record the next
 * reader has to wade through.
 */

import { stat } from "node:fs/promises";
import { EventLogParseError } from "../core/events/parse.js";
import type { EventRecord } from "../core/events/record.js";
import {
  noRunsMessage,
  renderEntryLines,
  renderRunEnding,
  renderRunHeader,
  renderRunList,
  logSizeNotice,
  renderRunTimeline,
  runReading,
} from "../core/events/report.js";
import {
  entriesAfter,
  lookupRun,
  summariseRuns,
  type RunSummary,
} from "../core/events/timeline.js";
import { DEFINITION_DIR } from "../core/paths.js";
import {
  EVENTS_PATH,
  readCompleteEvents,
  readEventLog,
  watchEventLog,
} from "../shell/events.js";
import { createGitAdapter } from "../shell/git.js";
import { resolveDefinitionRoot } from "../shell/sdd.js";

export interface EventsOptions {
  /** A run id, or an unambiguous prefix. Omitted means the most recent run. */
  readonly run?: string;
  readonly list?: boolean;
  readonly json?: boolean;
  readonly follow?: boolean;
}

/**
 * The only nonzero code this command has, and it never means "the run went badly".
 *
 * Hard rule 3, one layer out from the gate: a command that could not RUN is broken,
 * not a verdict. `wst events` has no verdict at all — it reports what a run
 * concluded, it does not conclude anything itself — so exit 1 is deliberately
 * unused. Everywhere else in this CLI 1 means "the change was rejected", and a
 * script that read a 1 from here would take a BLOCKED run it merely LOOKED AT as a
 * block of its own.
 */
const EXIT_COULD_NOT_RUN = 2;

/** The event, plus the one derived field a reader wants: when it happened in the run. */
const eventJson = (event: EventRecord, offsetMs: number | null): object => ({
  ...event,
  offsetMs,
});

/**
 * `reading` is published alongside `ending` on purpose. A consumer handed
 * `status: "pass"` next to `exit: 2` and left to work it out will conclude the run
 * passed — the same wrong conclusion the text render exists to prevent.
 */
const summaryJson = (summary: RunSummary): object => ({
  run: summary.run,
  startedAt: summary.startedAt,
  endedAt: summary.endedAt,
  durationMs: summary.durationMs,
  eventCount: summary.eventCount,
  reading: runReading(summary.ending),
  ending: summary.ending,
});

const runJson = (summary: RunSummary): object => ({
  ...summaryJson(summary),
  events: summary.events.map((e) => eventJson(e.event, e.offsetMs)),
});

/**
 * Tail a run to its end.
 *
 * The header is printed once, then a line per event as it lands, then the ending —
 * all through the same renderers the one-shot read uses, so a tailed run and a
 * read-back run never describe the same events differently.
 */
async function followRun(
  definitionRoot: string,
  initial: RunSummary,
  logPath: string,
  json: boolean,
): Promise<number> {
  let printedThrough = -1;

  const print = (summary: RunSummary): void => {
    for (const entry of entriesAfter(summary, printedThrough)) {
      console.log(
        json
          ? JSON.stringify(eventJson(entry.event, entry.offsetMs))
          : renderEntryLines(entry, summary.ending).join("\n"),
      );
      printedThrough = entry.event.seq;
    }
  };

  const finish = (summary: RunSummary): void => {
    console.log(json ? JSON.stringify(summaryJson(summary)) : renderRunEnding(summary).join("\n"));
  };

  if (!json) console.log(renderRunHeader(initial, { following: true }));
  print(initial);
  // Already over. Following a finished run is not an error — you cannot know it
  // finished until you look — so this is the ordinary ending, not a special case.
  if (initial.ending.kind !== "unterminated") {
    finish(initial);
    return 0;
  }

  return await new Promise<number>((resolve) => {
    let stop = (): void => undefined;
    // A read slower than the poll interval must not overlap the next one: two
    // in-flight reads finish in either order, and the later-finishing one would
    // rewind `printedThrough` and reprint lines.
    let reading = false;

    const tick = async (): Promise<void> => {
      if (reading) return;
      reading = true;
      try {
        const summary = summariseRuns(await readCompleteEvents(definitionRoot)).find(
          (s) => s.run === initial.run,
        );
        if (summary === undefined) return;
        print(summary);
        if (summary.ending.kind !== "unterminated") {
          stop();
          finish(summary);
          resolve(0);
        }
      } catch (cause) {
        // Corruption BEFORE the last newline is real corruption, not a write in
        // flight, and `readCompleteEvents` has already ruled the second out. Stop
        // tailing and say which line, rather than silently going quiet.
        stop();
        console.error(corruptMessage(logPath, cause));
        resolve(EXIT_COULD_NOT_RUN);
      } finally {
        reading = false;
      }
    };

    stop = watchEventLog(definitionRoot, () => void tick());
    // Once immediately: events appended between the read above and the watch
    // starting would otherwise wait for the next write to be noticed.
    void tick();
  });
}

/** A corrupt log is reported AS corrupt, naming the line. Never rendered as a short run. */
function corruptMessage(logPath: string, cause: unknown): string {
  if (cause instanceof EventLogParseError) {
    // A log that stops parsing at line N and a run that stopped at line N look
    // identical once the bad lines are dropped, which is the one reading this
    // command must never produce.
    return (
      `${logPath} could not be read, so no run was rendered:\n  ${cause.message}\n` +
      `  Nothing above is a partial timeline — a log this reader cannot parse is a log ` +
      `it will not summarise.`
    );
  }
  return `${logPath} could not be read:\n  ${(cause as Error).message}`;
}

export async function runEvents(
  opts: EventsOptions = {},
  cwd: string = process.cwd(),
): Promise<number> {
  if (opts.list === true && opts.follow === true) {
    console.error("--follow tails one run; --list shows every run. Pick one.");
    return EXIT_COULD_NOT_RUN;
  }

  const repoRoot = await createGitAdapter(cwd).repoRoot();
  if (repoRoot === null) {
    console.error("not inside a git repository — the event log lives in one");
    return EXIT_COULD_NOT_RUN;
  }

  let definitionRoot: string;
  try {
    definitionRoot = await resolveDefinitionRoot(repoRoot);
  } catch (cause) {
    console.error((cause as Error).message);
    return EXIT_COULD_NOT_RUN;
  }
  const logPath = `${DEFINITION_DIR}/${EVENTS_PATH}`;

  let records: EventRecord[];
  try {
    records = await readEventLog(definitionRoot);
  } catch (cause) {
    console.error(corruptMessage(logPath, cause));
    return EXIT_COULD_NOT_RUN;
  }

  const runs = summariseRuns(records);
  if (runs.length === 0) {
    // Missing and empty are the same fact, and neither is a fault: it is what a
    // repo that has not run the gate yet looks like.
    console.log(opts.json === true ? JSON.stringify({ runs: [] }, null, 2) : noRunsMessage(logPath));
    return 0;
  }

  if (opts.list === true) {
    console.log(
      opts.json === true
        ? JSON.stringify({ runs: runs.map(summaryJson) }, null, 2)
        : renderRunList(runs),
    );
    return 0;
  }

  // Said once, on the default view, and only when the file is big enough to
  // wonder about. Nobody has a way to know it is disposable otherwise.
  try {
    const { size } = await stat(logPath);
    const notice = logSizeNotice(logPath, size);
    if (notice !== null && opts.json !== true) console.log(notice + "\n");
  } catch {
    // The log was just read, so this cannot normally fail. If it does, the size
    // is a nicety and the timeline is the answer.
  }

  let summary = runs[0] as RunSummary;
  if (opts.run !== undefined) {
    const found = lookupRun(runs, opts.run);
    if (found.kind === "unknown") {
      // NOT a fallback to the newest run. Answering a question about run X with run
      // Y's timeline produces output indistinguishable from a correct answer.
      console.error(
        `no run in ${logPath} matches "${opts.run}" — \`wst events --list\` shows the ` +
          `${runs.length} that are there`,
      );
      return EXIT_COULD_NOT_RUN;
    }
    if (found.kind === "ambiguous") {
      console.error(
        `"${opts.run}" matches ${found.matches.length} runs: ${found.matches.join(", ")}`,
      );
      return EXIT_COULD_NOT_RUN;
    }
    summary = found.summary;
  }

  if (opts.follow === true) {
    return await followRun(definitionRoot, summary, logPath, opts.json === true);
  }

  console.log(opts.json === true ? JSON.stringify(runJson(summary), null, 2) : renderRunTimeline(summary));
  return 0;
}
