import { describe, expect, it } from "vitest";
import { buildInterview } from "../init/interview.js";
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
    expect(at(START(), ["tab"]).at).toBe(1);
    expect(at(START(), ["shift-tab"]).at).toBe(0);
    const last = at(START(), Array<string>(QUESTIONS.length + 3).fill("tab"));
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
  const risk = (): InterviewState => at(START(), ["tab"]);

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
  const paths = (): InterviewState => at(START(), ["tab", "tab"]);

  it("commits a line with enter and starts the next", () => {
    const s = at(type(paths(), "src/**"), ["return"]);

    expect(answersOf(s).sourcePaths).toEqual(["src/**"]);
  });

  it("keeps several", () => {
    const s = at(type(at(type(paths(), "src/**"), ["return"]), "apps/*/src/**"), ["return"]);

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
    const result = pressIn(s, "ctrl-s");

    expect(result.action.kind).toBe("write");
    expect(result.action.kind === "write" && result.action.answers.purpose).toBe("a task app");
  });
});
