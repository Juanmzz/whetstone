/**
 * The screen bare `wst` opens, as a state machine. PURE.
 *
 * A launcher and not a shell: picking a row closes this and runs the command in
 * the terminal, so `ready` still prints a report a pipe can read. What the menu
 * buys over `--help` is the state beside each row: which of these this repo can
 * do right now, and what the ones it cannot are waiting for.
 *
 * FOUR ENTRIES, because the product is three commands and a drawer. The eight-row
 * index answered "what can this tool do", which is a question you ask once; the
 * diagnostics that are not part of the normal workflow live one key away.
 */

import { DEFINITION_DIR } from "../paths.js";
import { prePushGate, type StatusReport } from "../status/report.js";

/** Everything the launcher can run. Standby commands are deliberately absent. */
export type HomeCommand = "init" | "ready" | "status" | "triage" | "check";

/** A row on the primary screen. `diagnostics` opens the drawer rather than running. */
export type HomeEntry = HomeCommand | "diagnostics";

export interface HomeRow {
  readonly entry: HomeEntry;
  /** What the row says. A human outcome, never a command name alone. */
  readonly what: string;
  /** What it reads and writes. Shown under the cursor. */
  readonly detail: readonly string[];
  /** The state this row is in, or what it is waiting for. Null when there is none. */
  readonly note: string | null;
  /** Two or three words on the row itself, for a row that cannot run. */
  readonly state: string | null;
  readonly available: boolean;
}

interface Spec {
  readonly entry: HomeEntry;
  readonly what: string;
  readonly detail: readonly string[];
  /** Whether this row reads the definition layer. Everything but `status` does. */
  readonly needsDefinition: boolean;
}

const PRIMARY: readonly Spec[] = [
  {
    entry: "init",
    what: "Initialize verification",
    detail: [
      `reads this repo's own scripts and writes ${DEFINITION_DIR}/: the checks,`,
      "and how to route them. Nothing else, and it asks before it writes.",
    ],
    needsDefinition: false,
  },
  {
    entry: "ready",
    what: "Check readiness",
    detail: [
      "resolves what this task changed and runs the checks over it. It takes no",
      "arguments. Answers Ready, Needs work, or Verification incomplete.",
    ],
    needsDefinition: true,
  },
  {
    entry: "status",
    what: "Show status",
    detail: [
      `reads the repo, ${DEFINITION_DIR}/ and the judge on PATH. Writes nothing.`,
      "Says what is here and what is missing.",
    ],
    needsDefinition: false,
  },
  {
    entry: "diagnostics",
    what: "Advanced diagnostics",
    detail: ["classify a change without running it, and read the check registry."],
    needsDefinition: true,
  },
];

const ADVANCED: readonly Spec[] = [
  {
    entry: "triage",
    what: "Classify a change",
    detail: ["which tier a change earns and which checks would apply. Runs none."],
    needsDefinition: true,
  },
  {
    entry: "check",
    what: "Read the check registry",
    detail: ["every check this repo has, what it runs, and whether it may block."],
    needsDefinition: true,
  },
];

export interface HomeState {
  readonly rows: readonly HomeRow[];
  readonly advanced: readonly HomeRow[];
  readonly cursor: number;
  readonly branch: string | null;
  readonly repo: string | null;
  readonly judge: string;
  readonly armed: boolean;
  /** What this repo needs now, in a sentence. Null when there is nothing to say. */
  readonly hint: string | null;
  readonly view: "primary" | "advanced";
}

export type HomeAction =
  | { readonly kind: "none" }
  | { readonly kind: "quit" }
  | { readonly kind: "run"; readonly command: HomeCommand };

const NONE: HomeAction = { kind: "none" };

function rowsFrom(specs: readonly Spec[], report: StatusReport): readonly HomeRow[] {
  const { facts } = report;
  return specs.map((spec): HomeRow => {
    if (facts.repoRoot === null) {
      return {
        ...spec,
        note: "not a git repository, and Whetstone is git-native by design",
        state: "needs a git repo",
        available: false,
      };
    }
    if (spec.entry === "init") {
      return facts.definitionPresent
        ? { ...spec, note: `${DEFINITION_DIR}/ exists already`, state: "already done", available: false }
        : { ...spec, note: null, state: null, available: true };
    }
    if (spec.needsDefinition && !facts.definitionPresent) {
      return {
        ...spec,
        note: `no ${DEFINITION_DIR}/ yet: initialize first`,
        state: "needs init",
        available: false,
      };
    }
    return { ...spec, note: noteFor(spec.entry, report), state: null, available: true };
  });
}

/** What an available row is worth saying beyond its own description. */
function noteFor(entry: HomeEntry, report: StatusReport): string | null {
  if (entry !== "ready") return null;
  return prePushGate(report.facts.hooks, report.facts.repoRoot) === "off"
    ? "no push hook is armed, so this runs when you ask and not before"
    : null;
}

/** One sentence on what this repo needs, above the rows. */
function hintFor(report: StatusReport): string | null {
  const { facts } = report;
  if (facts.repoRoot === null) return null;
  if (!facts.definitionPresent) return `nothing here yet: no ${DEFINITION_DIR}/ to verify against`;
  const dirty = facts.uncommitted ?? [];
  return dirty.length === 0 ? null : `${String(dirty.length)} uncommitted file(s)`;
}

export function openHome(report: StatusReport): HomeState {
  const root = report.facts.repoRoot;
  const rows = rowsFrom(PRIMARY, report);
  // On the first row somebody can actually press enter on. Opening on a row that
  // refuses makes the first keystroke of every session do nothing.
  const first = rows.findIndex((r) => r.available);
  return {
    rows,
    advanced: rowsFrom(ADVANCED, report),
    cursor: first < 0 ? 0 : first,
    branch: report.facts.branch,
    repo: root === null ? null : (root.split("/").at(-1) ?? null),
    judge: report.facts.judge.name,
    armed: prePushGate(report.facts.hooks, report.facts.repoRoot) !== "off",
    hint: hintFor(report),
    view: "primary",
  };
}

const shown = (state: HomeState): readonly HomeRow[] =>
  state.view === "primary" ? state.rows : state.advanced;

/** Clamped, not wrapped: a cursor that wraps stops being a position. */
function move(state: HomeState, delta: number): HomeState {
  const last = Math.max(shown(state).length - 1, 0);
  return { ...state, cursor: Math.min(Math.max(state.cursor + delta, 0), last) };
}

export function pressHome(state: HomeState, key: string): { state: HomeState; action: HomeAction } {
  // Vim keys are safe here and not in the interview: no row is a text field, so
  // no letter is a character somebody is trying to type.
  if (key === "up" || key === "k") return { state: move(state, -1), action: NONE };
  if (key === "down" || key === "j") return { state: move(state, 1), action: NONE };
  if (key === "q") return { state, action: { kind: "quit" } };
  // `esc` leaves the drawer rather than the program, which is what it means
  // everywhere else in this TUI.
  if (key === "escape") {
    return state.view === "advanced"
      ? { state: { ...state, view: "primary", cursor: 0 }, action: NONE }
      : { state, action: { kind: "quit" } };
  }

  if (key === "return") {
    const row = shown(state)[state.cursor];
    if (row === undefined || !row.available) return { state, action: NONE };
    if (row.entry === "diagnostics") {
      return { state: { ...state, view: "advanced", cursor: 0 }, action: NONE };
    }
    return { state, action: { kind: "run", command: row.entry } };
  }

  return { state, action: NONE };
}

const point = (on: boolean): string => (on ? "›" : " ");

export function renderHome(state: HomeState): readonly string[] {
  // No name here: `banner.ts` draws it beside the stone, a row up and bigger.
  const where = [state.repo, state.branch ?? "(no branch)", `judge ${state.judge}`]
    .filter((p) => p !== null)
    .join(" · ");

  const lines: string[] = [
    "",
    `  ${where}`,
    `  ${state.armed ? "verification runs on every push" : "verification runs when you ask"}`,
    "",
  ];
  if (state.view === "primary" && state.hint !== null) lines.push(`  ${state.hint}`, "");
  if (state.view === "advanced") lines.push("  Advanced diagnostics", "");

  for (const [i, row] of shown(state).entries()) {
    const here = i === state.cursor;
    lines.push(`  ${point(here)} ${row.available ? row.what : `${row.what}  ${row.state ?? ""}`}`);
    if (!here) continue;
    // The reason lives HERE and nowhere else. Printed inline as well, it was one
    // sentence twice on one screen, and the inline copy ran off the side.
    if (row.note !== null) lines.push(`      ${row.note}`);
    for (const line of row.detail) lines.push(`      ${line}`);
  }

  const back = state.view === "advanced" ? " · esc back" : "";
  lines.push("", `  ↑↓ move · enter select${back} · q quit`);
  return lines;
}
