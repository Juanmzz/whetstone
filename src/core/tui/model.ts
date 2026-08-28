/**
 * The configuration screen, as a state machine. PURE.
 *
 * `wst.yaml` was readable and not writable: the judge key existed, adr-0026
 * gave it meaning, and the only way to set it was to open the file. Everything
 * here is a function of state and one keypress, so the shell owns a raw-mode
 * reader and nothing else.
 */

import { AGENTS, type Agent } from "../config/schema.js";

export interface SkillState {
  readonly id: string;
  readonly active: boolean;
  /** What the file says it governs, in one sentence. Empty when it says nothing. */
  readonly summary: string;
}

export type View =
  | { readonly kind: "menu"; readonly cursor: number }
  | { readonly kind: "judge"; readonly cursor: number }
  | { readonly kind: "skills"; readonly cursor: number };

export interface TuiState {
  readonly view: View;
  readonly agent: Agent;
  readonly skills: readonly SkillState[];
  /** What the last write did, for the line that says it happened. */
  readonly wrote: string | null;
}

export type Action =
  | { readonly kind: "none" }
  | { readonly kind: "quit" }
  | { readonly kind: "save"; readonly agent: Agent; readonly skills: readonly string[] };

const NONE: Action = { kind: "none" };
const MENU = ["judge", "skills"] as const;

export function initialState(config: {
  agent: Agent;
  skills: readonly SkillState[];
}): TuiState {
  return {
    view: { kind: "menu", cursor: 0 },
    agent: config.agent,
    skills: config.skills,
    wrote: null,
  };
}

function rowsIn(state: TuiState): number {
  switch (state.view.kind) {
    case "menu":
      return MENU.length;
    case "judge":
      return AGENTS.length;
    case "skills":
      return state.skills.length;
  }
}

/** Clamped, not wrapped: a cursor that wraps stops being a position. */
function move(state: TuiState, delta: number): TuiState {
  const last = rowsIn(state) - 1;
  const cursor = Math.min(Math.max(state.view.cursor + delta, 0), Math.max(last, 0));
  return { ...state, view: { ...state.view, cursor }, wrote: null };
}

/**
 * Written when it is changed, which is what a checkbox already looks like it
 * means. Every write carries the whole settled state, because the shell rewrites
 * the file from it and a partial payload would drop the previous keypress.
 */
function write(state: TuiState, wrote: string): { state: TuiState; action: Action } {
  return {
    state: { ...state, wrote },
    action: {
      kind: "save",
      agent: state.agent,
      skills: state.skills.filter((s) => s.active).map((s) => s.id),
    },
  };
}

export function press(state: TuiState, key: string): { state: TuiState; action: Action } {
  // This screen has no text field, so it can afford vim keys. The interview cannot.
  if (key === "up" || key === "k") return { state: move(state, -1), action: NONE };
  if (key === "down" || key === "j") return { state: move(state, 1), action: NONE };

  if (key === "escape") {
    return { state: { ...state, view: { kind: "menu", cursor: 0 }, wrote: null }, action: NONE };
  }

  // Nothing to confirm on the way out: a change was written when it was made.
  if (key === "q") return { state, action: { kind: "quit" } };

  // Both. `space` is the checkbox convention and `enter` is what people press;
  // in this view enter had nothing else to do.
  if ((key === "space" || key === "return") && state.view.kind === "skills") {
    const at = state.view.cursor;
    const skills = state.skills.map((s, i) => (i === at ? { ...s, active: !s.active } : s));
    const flipped = skills[at];
    if (flipped === undefined) return { state, action: NONE };
    return write({ ...state, skills }, `${flipped.active ? "on" : "off"}: ${flipped.id}`);
  }

  if (key === "return") return enter(state);

  return { state, action: NONE };
}

function enter(state: TuiState): { state: TuiState; action: Action } {
  switch (state.view.kind) {
    case "menu": {
      const kind = MENU[state.view.cursor] ?? "judge";
      const cursor =
        kind === "judge" ? Math.max(AGENTS.indexOf(state.agent), 0) : 0;
      return { state: { ...state, view: { kind, cursor } }, action: NONE };
    }
    case "judge": {
      const agent = AGENTS[state.view.cursor] ?? state.agent;
      const back: TuiState = { ...state, agent, view: { kind: "menu", cursor: 0 }, wrote: null };
      // Picking what was already picked writes nothing. A file rewritten with
      // identical bytes is still a tool that touched a config nobody asked it to.
      return agent === state.agent ? { state: back, action: NONE } : write(back, `judge: ${agent}`);
    }
    case "skills":
      return { state, action: NONE };
  }
}

const mark = (on: boolean): string => (on ? "x" : " ");
const point = (on: boolean): string => (on ? "›" : " ");

/** A default terminal is eighty columns, and this line is already indented. */
const clip = (text: string): string => (text.length <= 70 ? text : `${text.slice(0, 69)}…`);

export function render(state: TuiState): readonly string[] {
  // Proof that the write happened, rather than a reminder that it has not.
  const head = ["whetstone config", ...(state.wrote === null ? [] : ["", `  wrote ${state.wrote}`]), ""];
  const foot = ["", `  ↑↓ move · ${keysFor(state)} · q quit`];

  switch (state.view.kind) {
    case "menu":
      return [
        ...head,
        ...MENU.map((row, i) => {
          const value = row === "judge" ? state.agent : `${activeCount(state)} active`;
          return `  ${point(i === state.view.cursor)} ${row.padEnd(8)} ${value}`;
        }),
        ...foot,
      ];
    case "judge":
      return [
        ...head,
        "  which adapter runs llm checks",
        "",
        ...AGENTS.map(
          (a, i) => `  ${point(i === state.view.cursor)} (${mark(a === state.agent)}) ${a}`,
        ),
        ...foot,
      ];
    case "skills": {
      const rows: string[] = [];
      state.skills.forEach((s, i) => {
        const here = i === state.view.cursor;
        rows.push(`  ${point(here)} [${mark(s.active)}] ${s.id}`);
        // Under the cursor only. The list was eight filenames, so deciding what
        // to switch off meant opening each file to find out what it governs.
        if (here && s.summary !== "") rows.push(`        ${clip(s.summary)}`);
      });
      return [
        ...head,
        "  active skills; the emitter references only these",
        "",
        ...rows,
        ...foot,
      ];
    }
  }
}

const activeCount = (state: TuiState): string =>
  `${String(state.skills.filter((s) => s.active).length)} of ${String(state.skills.length)}`;

function keysFor(state: TuiState): string {
  switch (state.view.kind) {
    case "menu":
      return "enter open";
    case "skills":
      return "space or enter toggle · esc back";
    default:
      return "enter pick · esc back";
  }
}
