import { describe, expect, it } from "vitest";
import { buildInterview, type InitQuestion } from "../init/interview.js";
import { answersOf, openInterview, pressIn, renderInterview, type InterviewState } from "./interview.js";

const QUESTIONS = buildInterview();

const START = (): InterviewState => openInterview(QUESTIONS);
const at = (s: InterviewState, keys: string[]): InterviewState =>
  keys.reduce((acc, k) => pressIn(acc, k).state, s);

const type = (s: InterviewState, text: string): InterviewState =>
  at(s, [...text].map((c) => (c === " " ? "space" : c)));

describe("moving between questions", () => {
  it("opens on the first one", () => {
    expect(START().at).toBe(0);
    expect(renderInterview(START()).join("\n")).toMatch(/purpose/i);
  });

  it("goes forward and back, and stops at the ends", () => {
    expect(at(START(), ["return"]).at).toBe(1);
    expect(at(START(), ["shift-tab"]).at).toBe(0);
    const last = at(START(), Array<string>(QUESTIONS.length + 3).fill("return"));
    expect(last.at).toBe(QUESTIONS.length - 1);
  });
});

describe("a text answer", () => {
  it("takes typed characters and shows them", () => {
    const s = type(START(), "a task app");

    expect(answersOf(s).purpose).toBe("a task app");
    expect(renderInterview(s).join("\n")).toContain("a task app");
  });

  it("deletes with backspace and stops at empty", () => {
    const s = at(type(START(), "abc"), ["backspace", "backspace", "backspace", "backspace"]);

    expect(answersOf(s).purpose).toBe("");
  });

  it("ignores a keypress that is not a character", () => {
    expect(answersOf(at(START(), ["f5"])).purpose).toBe("");
  });
});

describe("the risk flags", () => {
  const risk = (): InterviewState => at(START(), ["return"]);

  it("starts with every flag off, which is the honest default", () => {
    expect(answersOf(risk()).risk.money).toBe(false);
  });

  it("toggles the option under the cursor", () => {
    // First option is `money`; space is the toggle, as on the config screen.
    expect(answersOf(at(risk(), ["space"])).risk.money).toBe(true);
    expect(answersOf(at(risk(), ["space", "space"])).risk.money).toBe(false);
  });

  it("moves between options without leaving the question", () => {
    const s = at(risk(), ["down", "space"]);

    expect(answersOf(s).risk.money).toBe(false);
    expect(answersOf(s).risk.personalData).toBe(true);
    expect(s.fields[1]!.option).toBe(1);
  });
});

describe("a list answer", () => {
  const paths = (): InterviewState => at(START(), ["return", "return"]);

  it("commits a line with ctrl-n and starts the next", () => {
    // `enter` advances the question, here and everywhere else. Adding a line is
    // the thing only this screen does, so it is the thing with its own key.
    const s = at(type(paths(), "src/**"), ["ctrl-n"]);

    expect(answersOf(s).sourcePaths).toEqual(["src/**"]);
  });

  it("keeps several", () => {
    const s = at(type(at(type(paths(), "src/**"), ["ctrl-n"]), "apps/*/src/**"), ["ctrl-n"]);

    expect(answersOf(s).sourcePaths).toEqual(["src/**", "apps/*/src/**"]);
  });

  it("refuses to commit an empty line rather than storing one", () => {
    expect(answersOf(at(paths(), ["return"])).sourcePaths).toEqual([]);
  });
});

describe("leaving", () => {
  it("quits on escape, which no text field can swallow", () => {
    expect(pressIn(START(), "escape").action).toEqual({ kind: "cancel" });
  });

  it("will not submit while a required answer is missing", () => {
    // `purpose` is required by validateAnswers; submitting without it would
    // send the caller into an error it can see coming.
    expect(pressIn(START(), "ctrl-s").action.kind).toBe("none");
    expect(renderInterview(pressIn(START(), "ctrl-s").state).join("\n")).toMatch(/purpose/i);
  });

  it("takes ctrl-d as well, because ctrl-s is XOFF in some terminals", () => {
    const s = type(START(), "a task app");

    expect(pressIn(s, "ctrl-d").action.kind).toBe("write");
  });

  it("submits once the required answers are there", () => {
    const s = type(START(), "a task app");
    const result = pressIn(s, "ctrl-d");

    expect(result.action.kind).toBe("write");
    expect(result.action.kind === "write" && result.action.answers.purpose).toBe("a task app");
  });
});

describe("a pre-filled question opens with the answer in it, editable", () => {
  const q = (over: Partial<InitQuestion>): InitQuestion => ({
    id: "stack",
    prompt: "p",
    why: "w",
    kind: "text",
    options: [],
    defaultAnswer: null,
    ...over,
  });

  it("puts a text default in the draft, so a keystroke edits it", () => {
    const s = openInterview([q({ defaultAnswer: "TypeScript, Node >=22" })]);

    expect(renderInterview(s).join("\n")).toContain("TypeScript, Node >=22");
    expect(answersOf(s).stack).toBe("TypeScript, Node >=22");
  });

  it("splits a paths default into committed lines, one per glob", () => {
    const s = openInterview([
      q({ id: "source-paths", kind: "paths", defaultAnswer: "apps/*/src/**\npackages/*/**" }),
    ]);

    expect(answersOf(s).sourcePaths).toEqual(["apps/*/src/**", "packages/*/**"]);
  });

  it("lets backspace clear a default, which is what makes it a draft and not a decision", () => {
    let s = openInterview([q({ defaultAnswer: "ab" })]);
    s = pressIn(pressIn(s, "backspace").state, "backspace").state;

    expect(answersOf(s).stack).toBeNull();
  });

  it("says the value came from the repo, so nobody signs a reading blind", () => {
    const s = openInterview([q({ defaultAnswer: "TypeScript" })]);
    expect(renderInterview(s).join("\n")).toMatch(/read from this repo/i);
  });

  it("opens empty where nothing was declared", () => {
    expect(answersOf(openInterview([q({})])).stack).toBeNull();
  });
});

describe("one key, one meaning", () => {
  const ask = (kind: InitQuestion["kind"], id = "stack"): InitQuestion => ({
    id: id as never,
    prompt: "p",
    why: "w",
    kind,
    options: [{ value: "a", label: "a" }],
    defaultAnswer: null,
  });

  it("advances on enter from every kind of question, including a list", () => {
    // It used to add a line on `paths`, advance undocumented on `flags`, and run
    // a command in the launcher. Three meanings in three consecutive screens.
    const s = openInterview([ask("paths", "source-paths"), ask("text")]);
    expect(pressIn(s, "return").state.at).toBe(1);
  });

  it("adds a line with ctrl-n, and says so", () => {
    const s = openInterview([ask("paths", "source-paths"), ask("text")]);
    const typed = ["a", "b"].reduce((acc, k) => pressIn(acc, k).state, s);

    const added = pressIn(typed, "ctrl-n").state;

    expect(answersOf(added).sourcePaths).toEqual(["ab"]);
    expect(renderInterview(added).join("\n")).toMatch(/ctrl-n/);
  });

  it("documents every key that does something, on every screen", () => {
    // A key that is undocumented but works teaches the wrong effect. This asserts
    // the WHOLE set rather than two of them: the version that grepped for `enter`
    // and `esc` passed while `tab` still moved and had been dropped from the
    // legend.
    const always = ["enter", "shift-tab", "ctrl-d", "esc"];
    const also: Record<string, readonly string[]> = {
      text: [],
      flags: ["space"],
      paths: ["space", "ctrl-n"],
    };
    for (const kind of ["text", "flags", "paths"] as const) {
      const legend = renderInterview(openInterview([ask(kind), ask("text")])).at(-1) ?? "";
      for (const key of [...always, ...(also[kind] ?? [])]) expect(legend).toContain(key);
    }
  });

  it("mentions no key that does nothing, which is the other half of the same rule", () => {
    const legend = renderInterview(openInterview([ask("text"), ask("text")])).at(-1) ?? "";
    // `tab` was in the legend after it stopped being the way forward.
    for (const key of ["space", "ctrl-n"]) expect(legend).not.toContain(key);
  });
});

/**
 * A list question is a checklist of what was found, not a blank page.
 *
 * Two bugs and a complaint, one shape. `enter` discarded whatever was typed but
 * not committed, and the legend told you to press it. A line the repo proposed
 * could never be removed, because nothing deletes a committed line. And typing
 * a glob per line is the part of `init` that got called uncomfortable three
 * times in one sitting.
 */
describe("a list question you tick rather than type", () => {
  const paths = (
    candidates: readonly string[],
    picked = candidates,
    id: InitQuestion["id"] = "source-paths",
  ): InitQuestion => ({
    id,
    prompt: "where does the code live?",
    why: "w",
    kind: "paths",
    options: candidates.map((c) => ({ value: c, label: c })),
    defaultAnswer: picked.join("\n"),
  });

  const open = () =>
    openInterview([paths(["apps/*/src/**", "packages/*/**"]), paths(["x"], ["x"], "stack")]);

  it("opens with every candidate found, already ticked", () => {
    expect(answersOf(open()).sourcePaths).toEqual(["apps/*/src/**", "packages/*/**"]);
  });

  it("UNTICKS one, which the old text field could not do at all", () => {
    const off = pressIn(open(), "space").state;
    expect(answersOf(off).sourcePaths).toEqual(["packages/*/**"]);
  });

  it("keeps a candidate on the screen after it is unticked, so it can come back", () => {
    const off = pressIn(open(), "space").state;
    expect(renderInterview(off).join("\n")).toContain("apps/*/src/**");
    expect(answersOf(pressIn(off, "space").state).sourcePaths).toContain("apps/*/src/**");
  });

  it("answers with nothing when every candidate is unticked", () => {
    const none = ["space", "down", "space"].reduce((s, k) => pressIn(s, k).state, open());
    expect(answersOf(none).sourcePaths).toEqual([]);
  });

  it("adds one nobody found, by typing it and pressing ctrl-n", () => {
    const typed = ["e", "2", "e", "/", "*", "*"].reduce((s, k) => pressIn(s, k).state, open());
    const added = pressIn(typed, "ctrl-n").state;

    expect(answersOf(added).sourcePaths).toContain("e2e/**");
  });

  it("does not lose what was typed when enter advances the question", () => {
    // The bug: `enter` called `step` and the pending draft went nowhere, while
    // the legend on that exact screen said `enter next`.
    const typed = ["e", "2", "e"].reduce((s, k) => pressIn(s, k).state, open());
    const next = pressIn(typed, "return").state;

    expect(next.at).toBe(1);
    expect(answersOf(next).sourcePaths).toContain("e2e");
  });

  it("says where each candidate came from, so a wrong one is visible", () => {
    expect(renderInterview(open()).join("\n")).toMatch(/read from this repo/i);
  });

  it("still takes a typed answer in a repo where nothing was found", () => {
    const blank = openInterview([
      { ...paths([], []), defaultAnswer: null, options: [] },
      paths(["x"], ["x"], "stack"),
    ]);
    const typed = ["l", "i", "b"].reduce((s, k) => pressIn(s, k).state, blank);

    expect(answersOf(pressIn(typed, "ctrl-n").state).sourcePaths).toEqual(["lib"]);
  });
});
