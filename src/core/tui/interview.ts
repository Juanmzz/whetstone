/**
 * `wst init`'s interview, as a state machine. PURE.
 *
 * It printed seven questions and told you to re-run with flags, which is a
 * printed form rather than an interview. Two of the questions are multi-select
 * and two are lists, so answering them on a command line means nested quoting.
 */

import {
  NO_RISK,
  type InitQuestion,
  type InterviewAnswers,
  type RiskProfile,
  type StrictPath,
} from "../init/interview.js";

interface Field {
  /** What is being typed right now. */
  readonly draft: string;
  /** Committed lines, for a `paths` question. */
  readonly lines: readonly string[];
  /** Selected values, for a `flags` question. */
  readonly picked: readonly string[];
  /** Which option the cursor is on, for a `flags` question. */
  readonly option: number;
}

export interface InterviewState {
  readonly questions: readonly InitQuestion[];
  /** Which question. The option inside one lives in that question's field. */
  readonly at: number;
  readonly fields: readonly Field[];
  readonly complaint: string | null;
}

export type InterviewAction =
  | { readonly kind: "none" }
  | { readonly kind: "cancel" }
  | { readonly kind: "write"; readonly answers: InterviewAnswers };

const EMPTY: Field = Object.freeze({ draft: "", lines: [], picked: [], option: 0 });
const NONE: InterviewAction = { kind: "none" };

export function openInterview(questions: readonly InitQuestion[]): InterviewState {
  return {
    questions,
    at: 0,
    fields: questions.map(() => EMPTY),
    complaint: null,
  };
}

const current = (s: InterviewState): InitQuestion => s.questions[s.at]!;
const field = (s: InterviewState): Field => s.fields[s.at]!;

function withField(s: InterviewState, next: Field): InterviewState {
  return { ...s, fields: s.fields.map((f, i) => (i === s.at ? next : f)), complaint: null };
}

/** One printable character, or nothing. */
function charOf(key: string): string | null {
  if (key === "space") return " ";
  return key.length === 1 ? key : null;
}

export function answersOf(s: InterviewState): InterviewAnswers {
  const byId = new Map(s.questions.map((q, i) => [q.id, s.fields[i]!]));
  const f = (id: string): Field => byId.get(id as never) ?? EMPTY;

  const risk = f("risk").picked;
  const profile: RiskProfile = {
    money: risk.includes("money"),
    personalData: risk.includes("personalData"),
    productionData: risk.includes("productionData"),
    authn: risk.includes("authn"),
    safetyCritical: risk.includes("safetyCritical"),
    note: null,
  };

  const strict: StrictPath[] = f("strict-paths")
    .lines.map((line) => {
      const at = line.indexOf(":");
      return at < 0
        ? { glob: line.trim(), reason: "" }
        : { glob: line.slice(0, at).trim(), reason: line.slice(at + 1).trim() };
    })
    .filter((p) => p.glob !== "");

  const stack = f("stack").draft.trim();

  return {
    purpose: f("purpose").draft.trim(),
    risk: risk.length === 0 ? NO_RISK : profile,
    sourcePaths: f("source-paths").lines,
    strictPaths: strict,
    stack: stack === "" ? null : stack,
    conventions: f("conventions").lines,
    opinions: f("opinions").picked,
  };
}

/** What `validateAnswers` would reject, asked before the caller has to see it. */
function missing(s: InterviewState): string | null {
  const a = answersOf(s);
  if (a.purpose === "") return "purpose is still empty, and the constitution needs it";
  return null;
}

function move(s: InterviewState, delta: number): InterviewState {
  const q = current(s);
  if (q.kind === "flags") {
    const last = Math.max(q.options.length - 1, 0);
    const option = Math.min(Math.max(field(s).option + delta, 0), last);
    return withField(s, { ...field(s), option });
  }
  return s;
}

function step(s: InterviewState, delta: number): InterviewState {
  const at = Math.min(Math.max(s.at + delta, 0), s.questions.length - 1);
  return { ...s, at, complaint: null };
}

export function pressIn(s: InterviewState, key: string): { state: InterviewState; action: InterviewAction } {
  if (key === "tab") return { state: step(s, 1), action: NONE };
  if (key === "shift-tab") return { state: step(s, -1), action: NONE };
  if (key === "up") return { state: move(s, -1), action: NONE };
  if (key === "down") return { state: move(s, 1), action: NONE };

  // NOT a letter. Every letter is text in half these questions, so a letter
  // shortcut is a character the user cannot type.
  if (key === "escape") return { state: s, action: { kind: "cancel" } };

  // Both: ctrl-s is XOFF in a terminal with flow control on, where it can
  // freeze the session instead of reaching here. ctrl-d has no such history.
  if (key === "ctrl-s" || key === "ctrl-d") {
    const complaint = missing(s);
    if (complaint !== null) return { state: { ...s, complaint, at: 0 }, action: NONE };
    return { state: s, action: { kind: "write", answers: answersOf(s) } };
  }

  const q = current(s);

  if (key === "space" && q.kind === "flags") {
    const value = q.options[field(s).option]?.value;
    if (value === undefined) return { state: s, action: NONE };
    const picked = field(s).picked.includes(value)
      ? field(s).picked.filter((v) => v !== value)
      : [...field(s).picked, value];
    return { state: withField(s, { ...field(s), picked }), action: NONE };
  }

  if (key === "backspace") {
    return { state: withField(s, { ...field(s), draft: field(s).draft.slice(0, -1) }), action: NONE };
  }

  if (key === "return") {
    if (q.kind !== "paths") return { state: step(s, 1), action: NONE };
    const line = field(s).draft.trim();
    if (line === "") return { state: s, action: NONE };
    return {
      state: withField(s, { ...field(s), lines: [...field(s).lines, line], draft: "" }),
      action: NONE,
    };
  }

  const ch = charOf(key);
  if (ch !== null && q.kind !== "flags") {
    return { state: withField(s, { ...field(s), draft: field(s).draft + ch }), action: NONE };
  }

  return { state: s, action: NONE };
}

const mark = (on: boolean): string => (on ? "x" : " ");

export function renderInterview(s: InterviewState): readonly string[] {
  const q = current(s);
  const f = field(s);
  const lines: string[] = [
    `wst init  ${String(s.at + 1)}/${String(s.questions.length)}  [${q.id}]`,
    "",
    `  ${q.prompt}`,
    "",
  ];

  if (q.kind === "flags") {
    q.options.forEach((o, i) => {
      const here = i === f.option ? "›" : " ";
      lines.push(`  ${here} [${mark(f.picked.includes(o.value))}] ${o.label}`);
    });
  } else {
    for (const line of f.lines) lines.push(`    · ${line}`);
    lines.push(`  › ${f.draft}_`);
  }

  lines.push("", `  ${q.why}`);
  if (s.complaint !== null) lines.push("", `  ${s.complaint}`);
  lines.push("", `  ${keysFor(q)} · tab next · shift-tab back · ctrl-d write · esc quit`);
  return lines;
}

function keysFor(q: InitQuestion): string {
  if (q.kind === "flags") return "↑↓ move · space toggle";
  if (q.kind === "paths") return "type · enter adds a line";
  return "type";
}
