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
  | { readonly kind: "skills"; readonly cursor: number }
  | { readonly kind: "confirm"; readonly cursor: number };

export interface TuiState {
  readonly view: View;
  readonly agent: Agent;
  readonly skills: readonly SkillState[];
  readonly initial: { readonly agent: Agent; readonly skills: readonly SkillState[] };
  readonly dirty: boolean;
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
    initial: { agent: config.agent, skills: config.skills },
    dirty: false,
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
    case "confirm":
      return 2;
  }
}

/** Clamped, not wrapped: a cursor that wraps stops being a position. */
function move(state: TuiState, delta: number): TuiState {
  const last = rowsIn(state) - 1;
  const cursor = Math.min(Math.max(state.view.cursor + delta, 0), Math.max(last, 0));
  return { ...state, view: { ...state.view, cursor } };
}

function changed(state: TuiState): boolean {
  if (state.agent !== state.initial.agent) return true;
  return state.skills.some((s, i) => s.active !== state.initial.skills[i]?.active);
}

export function press(state: TuiState, key: string): { state: TuiState; action: Action } {
  // This screen has no text field, so it can afford vim keys. The interview cannot.
  if (key === "up" || key === "k") return { state: move(state, -1), action: NONE };
  if (key === "down" || key === "j") return { state: move(state, 1), action: NONE };

  if (key === "escape") {
    return { state: { ...state, view: { kind: "menu", cursor: 0 } }, action: NONE };
  }

  if (key === "q") {
    if (!state.dirty) return { state, action: { kind: "quit" } };
    return { state: { ...state, view: { kind: "confirm", cursor: 0 } }, action: NONE };
  }

  if (key === "s") {
    if (!state.dirty) return { state, action: NONE };
    return {
      state,
      action: {
        kind: "save",
        agent: state.agent,
        skills: state.skills.filter((s) => s.active).map((s) => s.id),
      },
    };
  }

  // Both. `space` is the checkbox convention and `enter` is what people press;
  // in this view enter had nothing else to do.
  if ((key === "space" || key === "return") && state.view.kind === "skills") {
    const skills = state.skills.map((s, i) =>
      i === state.view.cursor ? { ...s, active: !s.active } : s,
    );
    const next = { ...state, skills };
    return { state: { ...next, dirty: changed(next) }, action: NONE };
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
      const next = { ...state, agent, view: { kind: "menu", cursor: 0 } as View };
      return { state: { ...next, dirty: changed(next) }, action: NONE };
    }
    case "skills":
      return { state, action: NONE };
    case "confirm":
      return state.view.cursor === 0
        ? { state, action: { kind: "quit" } }
        : { state: { ...state, view: { kind: "menu", cursor: 0 } }, action: NONE };
  }
}

const mark = (on: boolean): string => (on ? "x" : " ");
const point = (on: boolean): string => (on ? "›" : " ");

/** A default terminal is eighty columns, and this line is already indented. */
const clip = (text: string): string => (text.length <= 70 ? text : `${text.slice(0, 69)}…`);

export function render(state: TuiState): readonly string[] {
  // The pending edit was computed and never shown: `wst.yaml` is a tracked file,
  // so the write is deliberate rather than per-keypress, and until now the only
  // hint that anything was unsaved came from trying to quit.
  const head = ["whetstone config", ...(state.dirty ? ["", "  unsaved: `s` writes wst.yaml, `q` discards"] : []), ""];
  const foot = ["", `  ↑↓ move · ${keysFor(state)} · s save · q quit`];

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
    case "confirm":
      return [
        ...head,
        "  unsaved changes",
        "",
        `  ${point(state.view.cursor === 0)} discard them and quit`,
        `  ${point(state.view.cursor === 1)} go back`,
        ...foot,
      ];
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
