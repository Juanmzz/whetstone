/**
 * The screen bare `wst` opens, as a state machine. PURE.
 *
 * A launcher and not a shell: picking a row closes this and runs the command in
 * the terminal, so `gate` still prints a report you can pipe and `signal` is
 * still something a human types. What the menu buys over `--help` is the state
 * beside each row: which commands this repo can run right now, and what the
 * ones it cannot are waiting for.
 */

import { DEFINITION_DIR } from "../paths.js";
import { hooksArmed, type StatusReport } from "../status/report.js";

export type HomeCommand =
  | "init"
  | "config"
  | "status"
  | "check"
  | "triage"
  | "gate"
  | "update"
  | "retro";

export interface HomeRow {
  readonly command: HomeCommand;
  /** One line, in the imperative. What pressing enter does. */
  readonly what: string;
  /** What it reads and writes, and what its exit code means. Shown under the cursor. */
  readonly detail: readonly string[];
  /** The state this row is in, or what it is waiting for. Null when there is nothing to add. */
  readonly note: string | null;
  readonly available: boolean;
}

export interface HomeState {
  readonly rows: readonly HomeRow[];
  readonly cursor: number;
  readonly branch: string | null;
  readonly judge: string;
}

export type HomeAction =
  | { readonly kind: "none" }
  | { readonly kind: "quit" }
  | { readonly kind: "run"; readonly command: HomeCommand };

const NONE: HomeAction = { kind: "none" };

interface Spec {
  readonly command: HomeCommand;
  readonly what: string;
  /**
   * What it reads, what it writes, and what its exit code means. Shown under the
   * cursor.
   *
   * This is what the launcher has over typing the command: `wst --help` gives one
   * line each and a person picking between `triage` and `gate` needs to know that
   * one of them runs nothing and the other can block a push.
   */
  readonly detail: readonly string[];
  /** Whether this row reads the definition layer. Everything but `status` does. */
  readonly needsDefinition: boolean;
}

const SPECS: readonly Spec[] = [
  {
    command: "status",
    what: "what this repo has and what it is missing",
    detail: [
      `reads the repo, ${DEFINITION_DIR}/ and the judge on PATH. Writes nothing.`,
      "exit 1 means something it needs is not here, and it names which.",
    ],
    needsDefinition: false,
  },
  {
    command: "init",
    what: `interview this repo and write its ${DEFINITION_DIR}/`,
    detail: [
      "asks what the repo cannot say about itself, then writes the layer.",
      "the only row that creates anything. Refuses rather than overwrite.",
    ],
    needsDefinition: false,
  },
  {
    command: "gate",
    what: "run the checks over what has changed",
    detail: [
      "runs the checks matching your changed files. Minutes, not seconds.",
      "exit 1 is a check that FAILED. exit 2 is one that could not RUN,",
      "which is the gate being broken and not a verdict on your change.",
    ],
    needsDefinition: true,
  },
  {
    command: "triage",
    what: "classify the change and say which checks apply",
    detail: [
      "the selection `gate` does, printed instead of run. Nothing runs,",
      "nothing is judged. Run it to see what a push is about to cost you.",
    ],
    needsDefinition: true,
  },
  {
    command: "check",
    what: "the check registry, and what may block",
    detail: [
      `every check under ${DEFINITION_DIR}/checks/, whether it is on, and whether it`,
      "may block. Reads only. It is the list `gate` selects from.",
    ],
    needsDefinition: true,
  },
  {
    command: "config",
    what: "which judge runs llm checks, which skills are active",
    detail: [
      `the two settings in ${DEFINITION_DIR}/wst.yaml, edited in place.`,
      "a change is written the moment you make it.",
    ],
    needsDefinition: true,
  },
  {
    command: "update",
    what: "what changed since init wrote this repo",
    detail: [
      "compares the layer to what THIS version of wst would write now:",
      "edited here, outdated, missing. Reports, and never writes.",
    ],
    needsDefinition: true,
  },
  {
    command: "retro",
    what: "cluster the signals and propose rule changes",
    detail: [
      "groups the signals nobody processed and asks the judge what rule",
      "each implies. ONE MODEL CALL PER CLUSTER: it costs money and takes",
      "minutes. It asks first, and never applies what it proposes.",
    ],
    needsDefinition: true,
  },
];

export function homeRows(report: StatusReport): readonly HomeRow[] {
  const { facts } = report;
  const outsideRepo = facts.repoRoot === null;

  return SPECS.map((spec): HomeRow => {
    if (outsideRepo && spec.command !== "status") {
      return {
        ...spec,
        note: "not a git repository, and Whetstone is git-native by design",
        available: false,
      };
    }

    if (spec.command === "init") {
      return facts.definitionPresent
        ? {
            ...spec,
            note: `${DEFINITION_DIR}/ exists already; \`update\` reports what changed`,
            available: false,
          }
        : { ...spec, note: null, available: true };
    }

    if (spec.needsDefinition && !facts.definitionPresent) {
      return { ...spec, note: `no ${DEFINITION_DIR}/ yet: run \`init\``, available: false };
    }

    return { ...spec, note: noteFor(spec.command, report), available: true };
  });
}

/** What an available row is worth saying beyond its own description. */
function noteFor(command: HomeCommand, report: StatusReport): string | null {
  if (command !== "gate") return null;

  const parts: string[] = [];
  // Available anyway. The deterministic half is what blocks in the pre-push hook,
  // and greying the row out would say the gate is unusable when most of it is not.
  if (report.facts.judge.version === null) {
    parts.push(`no \`${report.facts.judge.name}\` on PATH, so llm checks cannot run`);
  }
  if (!hooksArmed(report.facts.hooks, report.facts.repoRoot)) {
    parts.push("the pre-push hook is not armed, so this runs only when you ask");
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Opened from the report and not from a row list, so the header cannot end up
 * describing a different repo from the one the rows were built for.
 */
export function openHome(report: StatusReport): HomeState {
  return {
    rows: homeRows(report),
    cursor: 0,
    branch: report.facts.branch,
    judge: report.facts.judge.name,
  };
}

/** Clamped, not wrapped: a cursor that wraps stops being a position. */
function move(state: HomeState, delta: number): HomeState {
  const last = Math.max(state.rows.length - 1, 0);
  const cursor = Math.min(Math.max(state.cursor + delta, 0), last);
  return { ...state, cursor };
}

export function pressHome(state: HomeState, key: string): { state: HomeState; action: HomeAction } {
  // Vim keys are safe here and not in the interview: no row is a text field, so
  // no letter is a character somebody is trying to type.
  if (key === "up" || key === "k") return { state: move(state, -1), action: NONE };
  if (key === "down" || key === "j") return { state: move(state, 1), action: NONE };
  if (key === "q" || key === "escape") return { state, action: { kind: "quit" } };

  if (key === "return") {
    const row = state.rows[state.cursor];
    if (row === undefined || !row.available) return { state, action: NONE };
    return { state, action: { kind: "run", command: row.command } };
  }

  return { state, action: NONE };
}

const point = (on: boolean): string => (on ? "›" : " ");

export function renderHome(state: HomeState): readonly string[] {
  const lines: string[] = [
    "whetstone",
    "",
    `  ${state.branch ?? "(no branch)"} · judge ${state.judge}`,
    "",
  ];

  state.rows.forEach((row, i) => {
    const here = i === state.cursor;
    // The unavailable row stays on the list. One that disappears reads as one
    // that does not exist. It says `not now` in words rather than by a glyph,
    // because a dimmed row on a terminal whose theme nobody controls is a row
    // that just looks the same.
    lines.push(`  ${point(here)} ${row.command.padEnd(8)} ${row.available ? row.what : "not now"}`);
    if (!here) return;
    // The reason lives HERE and nowhere else. It used to be printed inline and
    // again at the foot when enter was pressed, which is one sentence twice on
    // one screen, and the inline copy ran off the side of the terminal.
    if (row.note !== null) lines.push(`             ${row.note}`);
    for (const line of row.detail) lines.push(`             ${line}`);
  });

  lines.push("", "  ↑↓ move · enter run · q quit");
  return lines;
}
