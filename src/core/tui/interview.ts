/**
 * `wst init`'s interview, as a state machine. PURE.
 *
 * It printed its questions and told you to re-run with flags, which is a printed
 * form rather than an interview. One of them is multi-select and two are lists,
 * so answering them on a command line means nested quoting.
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
  /**
   * Every candidate on the screen, ticked or not, for a `paths` question.
   *
   * Both are needed. `picked` is the answer; this is what stays visible, so
   * unticking a glob the repo proposed leaves it there to tick again. A list that
   * removed the row would be a list you cannot change your mind in.
   */
  readonly rows: readonly string[];
  /** What is ticked. For `flags` and for `paths` alike. */
  readonly picked: readonly string[];
  /** Which row the cursor is on. */
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

const EMPTY: Field = Object.freeze({ draft: "", rows: [], picked: [], option: 0 });
const NONE: InterviewAction = { kind: "none" };

/**
 * A pre-filled question opens with the value IN the field, not beside it as a
 * suggestion. It is a draft the repo wrote and a keystroke edits, which is the
 * difference between reading a repo and deciding for it.
 */
function seed(question: InitQuestion): Field {
  const value = question.defaultAnswer;
  if (value === null || value === "") return EMPTY;
  if (question.kind === "paths") {
    // Every candidate is a row AND ticked. The repo proposed them; a human unticks
    // what does not belong rather than retyping around it.
    const rows = value.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    return { ...EMPTY, rows, picked: rows };
  }
  if (question.kind === "flags") {
    const picked = value.split(",").map((v) => v.trim()).filter((v) => v !== "");
    // Only values the screen offers. A draft naming a flag nobody ships would
    // otherwise sit in the answers as a ticked box with no row.
    const offered = new Set(question.options.map((o) => o.value));
    return { ...EMPTY, picked: picked.filter((v) => offered.has(v)) };
  }
  return { ...EMPTY, draft: value };
}

export function openInterview(questions: readonly InitQuestion[]): InterviewState {
  return {
    questions,
    at: 0,
    fields: questions.map(seed),
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
    .picked.map((line) => {
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
    sourcePaths: f("source-paths").picked,
    strictPaths: strict,
    stack: stack === "" ? null : stack,
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
  const rows = q.kind === "paths" ? field(s).rows.length : q.options.length;
  if (rows === 0) return s;
  const option = Math.min(Math.max(field(s).option + delta, 0), rows - 1);
  return withField(s, { ...field(s), option });
}

/** What is being typed becomes a ticked row. Unchanged when there is nothing typed. */
function commit(s: InterviewState): InterviewState {
  if (current(s).kind !== "paths") return s;
  const line = field(s).draft.trim();
  if (line === "" || field(s).rows.includes(line)) {
    return line === "" ? s : withField(s, { ...field(s), draft: "" });
  }
  return withField(s, {
    ...field(s),
    rows: [...field(s).rows, line],
    picked: [...field(s).picked, line],
    draft: "",
  });
}

function step(s: InterviewState, delta: number): InterviewState {
  const at = Math.min(Math.max(s.at + delta, 0), s.questions.length - 1);
  return { ...s, at, complaint: null };
}

export function pressIn(s: InterviewState, key: string): { state: InterviewState; action: InterviewAction } {
  // `tab` is gone: it did what `enter` does and was not in the legend, which is
  // a key that teaches an effect nobody wrote down. `shift-tab` stays because it
  // is the only way back and it IS in the legend.
  if (key === "shift-tab") return { state: step(s, -1), action: NONE };
  if (key === "up") return { state: move(s, -1), action: NONE };
  if (key === "down") return { state: move(s, 1), action: NONE };

  // NOT a letter. Every letter is text in half these questions, so a letter
  // shortcut is a character the user cannot type.
  if (key === "escape") return { state: s, action: { kind: "cancel" } };

  if (key === "ctrl-d") {
    const complaint = missing(s);
    if (complaint !== null) return { state: { ...s, complaint, at: 0 }, action: NONE };
    return { state: s, action: { kind: "write", answers: answersOf(s) } };
  }

  const q = current(s);

  if (key === "space" && (q.kind === "flags" || q.kind === "paths")) {
    const value =
      q.kind === "paths" ? field(s).rows[field(s).option] : q.options[field(s).option]?.value;
    if (value === undefined) return { state: s, action: NONE };
    const picked = field(s).picked.includes(value)
      ? field(s).picked.filter((v) => v !== value)
      : [...field(s).picked, value];
    return { state: withField(s, { ...field(s), picked }), action: NONE };
  }

  if (key === "backspace") {
    return { state: withField(s, { ...field(s), draft: field(s).draft.slice(0, -1) }), action: NONE };
  }

  // ONE meaning, everywhere: enter goes to the next question. It used to add a
  // line here, advance undocumented on a checkbox screen, and run a command in
  // the launcher, which is three meanings in three consecutive screens of one
  // flow. Adding a line is its own key now, and the legend says so.
  // It COMMITS what is being typed on the way out. The legend says `enter next`
  // on the same screen, and dropping the draft silently is how a source path went
  // missing and the repo got a `.wst/` that governed no file.
  if (key === "return") return { state: step(commit(s), 1), action: NONE };

  // `ctrl-n` and not `ctrl-enter`: measured, a terminal sends the same byte for
  // enter and ctrl-enter, so the second is a key nobody can press. `enter` here
  // is the linefeed some terminals send for shift-enter, which costs nothing to
  // accept and works where it exists.
  if ((key === "ctrl-n" || key === "enter") && q.kind === "paths") {
    return { state: commit(s), action: NONE };
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
  } else if (q.kind === "paths") {
    f.rows.forEach((row, i) => {
      const here = i === f.option ? "›" : " ";
      lines.push(`  ${here} [${mark(f.picked.includes(row))}] ${row}`);
    });
    lines.push(`    + ${f.draft}_`);
  } else {
    lines.push(`  › ${f.draft}_`);
  }

  lines.push("", `  ${q.why}`);
  // Nobody signs a reading blind, and a model's guess is not a reading. The two
  // arrive in the same field, so the field has to say which.
  if (q.defaultFrom === "repo") lines.push("", "  read from this repo. Edit it or leave it.");
  if (q.defaultFrom === "draft") {
    lines.push("", "  DRAFTED by the judge from what it could see. Check it.");
  }
  if (s.complaint !== null) lines.push("", `  ${s.complaint}`);
  lines.push("", `  ${keysFor(q)} · enter next · shift-tab back · ctrl-d write · esc quit`);
  return lines;
}

function keysFor(q: InitQuestion): string {
  if (q.kind === "flags") return "↑↓ move · space toggle";
  if (q.kind === "paths") return "↑↓ move · space toggle · type + ctrl-n adds one";
  return "type";
}
