/**
 * One screen, many boxes, one answer. PURE.
 *
 * The interview's checkbox screen is welded to `InterviewAnswers`, so reading a
 * pick back off it means going through `RiskProfile`'s fixed keys. This is the
 * same interaction with the answer left as what it is: a list of ids.
 */

export interface PickerOption {
  readonly value: string;
  readonly label: string;
  /** One line under the cursor. What picking it does. */
  readonly detail?: string;
}

export interface PickerState {
  readonly title: string;
  readonly why: string;
  readonly options: readonly PickerOption[];
  readonly cursor: number;
  readonly picked: readonly string[];
}

export type PickerAction =
  | { readonly kind: "none" }
  | { readonly kind: "cancel" }
  | { readonly kind: "done"; readonly picked: readonly string[] };

const NONE: PickerAction = { kind: "none" };

export function openPicker(
  title: string,
  why: string,
  options: readonly PickerOption[],
  picked: readonly string[] = [],
): PickerState {
  return { title, why, options, cursor: 0, picked };
}

/** Clamped, not wrapped: a cursor that wraps stops being a position. */
function move(state: PickerState, delta: number): PickerState {
  const last = Math.max(state.options.length - 1, 0);
  return { ...state, cursor: Math.min(Math.max(state.cursor + delta, 0), last) };
}

export function pressPicker(
  state: PickerState,
  key: string,
): { state: PickerState; action: PickerAction } {
  if (key === "up") return { state: move(state, -1), action: NONE };
  if (key === "down") return { state: move(state, 1), action: NONE };
  if (key === "escape") return { state, action: { kind: "cancel" } };

  if (key === "space") {
    const value = state.options[state.cursor]?.value;
    if (value === undefined) return { state, action: NONE };
    const picked = state.picked.includes(value)
      ? state.picked.filter((v) => v !== value)
      : [...state.picked, value];
    return { state: { ...state, picked }, action: NONE };
  }

  // Both, and for the same reason as everywhere else in this interface: `enter`
  // is what a person presses to go on, and there is nowhere here for it to
  // advance to. `ctrl-d` matches the interview it leads into.
  if (key === "return" || key === "ctrl-d") {
    // The ORDER on screen, not the order they were ticked. It decides which
    // adapter drafts, and a decision that depends on click order is one nobody
    // can predict.
    const picked = state.options.map((o) => o.value).filter((v) => state.picked.includes(v));
    return { state, action: { kind: "done", picked } };
  }

  return { state, action: NONE };
}

const mark = (on: boolean): string => (on ? "x" : " ");
const point = (on: boolean): string => (on ? "›" : " ");

export function renderPicker(state: PickerState): readonly string[] {
  const lines: string[] = [state.title, "", `  ${state.why}`, ""];

  state.options.forEach((option, i) => {
    const here = i === state.cursor;
    lines.push(`  ${point(here)} [${mark(state.picked.includes(option.value))}] ${option.label}`);
    if (here && option.detail !== undefined) lines.push(`        ${option.detail}`);
  });

  lines.push("", "  ↑↓ move · space toggle · enter continue · esc quit");
  return lines;
}
