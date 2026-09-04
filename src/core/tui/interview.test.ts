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
    expect(renderInterview(START()).join("\n")).toMatch(/risk/i);
  });

  it("goes forward and back, and stops at the ends", () => {
    expect(at(START(), ["return"]).at).toBe(1);
    expect(at(START(), ["shift-tab"]).at).toBe(0);
    // Stops at the last question rather than wrapping. Enter THERE writes, which
    // is the next test's business, not this one's.
    const last = at(START(), Array<string>(QUESTIONS.length - 1).fill("return"));
    expect(last.at).toBe(QUESTIONS.length - 1);
  });
});

describe("a text answer", () => {
  /** `source-paths`, which is the first question with a field to type in. */
  const paths = (): InterviewState => at(START(), ["return"]);

  it("takes typed characters and shows them", () => {
    const s = type(paths(), "apps/*/src/**");

    expect(renderInterview(s).join("\n")).toContain("apps/*/src/**");
  });

  it("deletes with backspace and stops at empty", () => {
    const s = at(type(paths(), "abc"), ["backspace", "backspace", "backspace", "backspace"]);

    expect(answersOf(at(s, ["return"])).sourcePaths).toEqual([]);
  });

  it("ignores a keypress that is not a character", () => {
    expect(answersOf(at(paths(), ["f5", "return"])).sourcePaths).toEqual([]);
  });
});

describe("the risk flags", () => {
  const risk = (): InterviewState => START();

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
    expect(s.fields[0]!.option).toBe(1);
  });
});

describe("a list answer", () => {
  const paths = (): InterviewState => at(START(), ["return"]);

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
    // A source path is what every seeded check scopes itself to. Submitting with
    // none installs a definition layer that verifies nothing, and the caller would
    // walk into an error it could see coming.
    expect(pressIn(START(), "ctrl-s").action.kind).toBe("none");
    expect(renderInterview(pressIn(START(), "ctrl-d").state).join("\n")).toMatch(/source path/i);
  });

  it("takes ctrl-d as well, because ctrl-s is XOFF in some terminals", () => {
    const s = type(at(START(), ["return"]), "src/**");

    expect(pressIn(s, "ctrl-d").action.kind).toBe("write");
  });

  it("submits once the required answers are there", () => {
    const s = type(at(START(), ["return"]), "src/**");
    const result = pressIn(s, "ctrl-d");

    expect(result.action.kind).toBe("write");
    expect(result.action.kind === "write" && result.action.answers.sourcePaths).toEqual(["src/**"]);
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
    defaultFrom: null,
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

  it("says a reading came from the repo, so nobody signs one blind", () => {
    const s = openInterview([q({ defaultAnswer: "TypeScript", defaultFrom: "repo" })]);
    expect(renderInterview(s).join("\n")).toMatch(/read from this repo/i);
  });

  it("says a DRAFT was drafted, and never calls a model's guess a reading", () => {
    const s = openInterview([q({ defaultAnswer: "a task app", defaultFrom: "draft" })]);
    const screen = renderInterview(s).join("\n");

    expect(screen).toMatch(/drafted by the judge/i);
    expect(screen).not.toMatch(/read from this repo/i);
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
    defaultFrom: null,
  });

  it("advances on enter from every kind of question, including a list", () => {
    // It used to add a line on `paths`, advance undocumented on `flags`, and run
    // a command in the launcher. Three meanings in three consecutive screens.
    const s = openInterview([ask("paths", "source-paths"), ask("text")]);
    expect(pressIn(s, "return").state.at).toBe(1);
  });

  it("adds a line with enter, which is what a list does everywhere else", () => {
    // It was `ctrl-n`, and enter advanced. Typing an item and pressing enter is
    // what anyone does in a list, and here it left the question instead.
    const s = openInterview([ask("paths", "source-paths"), ask("text")]);
    const typed = ["a", "b"].reduce((acc, k) => pressIn(acc, k).state, s);

    const added = pressIn(typed, "return");

    expect(answersOf(added.state).sourcePaths).toEqual(["ab"]);
    expect(added.state.at).toBe(0);
    expect(renderInterview(added.state).join("\n")).toMatch(/enter adds one/);
  });

  it("moves on when enter is pressed with nothing typed, since there is nothing to add", () => {
    const s = openInterview([ask("paths", "source-paths"), ask("text")]);
    const typed = ["a", "b"].reduce((acc, k) => pressIn(acc, k).state, s);

    const after = pressIn(pressIn(typed, "return").state, "return").state;

    expect(after.at).toBe(1);
    expect(answersOf(after).sourcePaths).toEqual(["ab"]);
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
      paths: ["space"],
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
    defaultFrom: "repo",
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

  it("does not lose what was typed, whichever thing enter does next", () => {
    // The bug: `enter` called `step` and the pending draft went nowhere, while
    // the legend on that exact screen said `enter next`. It now adds the line and
    // stays; a second enter, with nothing left to add, moves on.
    const typed = ["e", "2", "e"].reduce((s, k) => pressIn(s, k).state, open());
    const added = pressIn(typed, "return").state;

    expect(added.at).toBe(0);
    expect(answersOf(added).sourcePaths).toContain("e2e");
    expect(pressIn(added, "return").state.at).toBe(1);
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

describe("a drafted checkbox screen opens with the boxes already ticked", () => {
  const risk = (defaultAnswer: string | null): InitQuestion => ({
    id: "risk",
    prompt: "p",
    why: "w",
    kind: "flags",
    options: [
      { value: "money", label: "money" },
      { value: "authn", label: "auth" },
    ],
    defaultAnswer,
    defaultFrom: defaultAnswer === null ? null : "draft",
  });

  it("ticks what the draft argued for, and leaves the rest", () => {
    const s = openInterview([risk("money")]);

    expect(answersOf(s).risk.money).toBe(true);
    expect(answersOf(s).risk.authn).toBe(false);
  });

  it("un-ticks on space, which is what makes it a draft and not a verdict", () => {
    const s = pressIn(openInterview([risk("money")]), "space").state;
    expect(answersOf(s).risk.money).toBe(false);
  });

  it("ignores a flag the screen does not offer, rather than ticking a row that is not there", () => {
    expect(answersOf(openInterview([risk("money,invented")])).risk.money).toBe(true);
  });
});

describe("candidates the repo offered but did not answer", () => {
  const tail = (): InitQuestion => ({
    id: "stack",
    prompt: "what",
    why: "because",
    kind: "text",
    options: [],
    defaultAnswer: null,
    defaultFrom: null,
  });

  const withCandidates = () =>
    openInterview([
      {
        id: "strict-paths",
        prompt: "which paths",
        why: "because",
        kind: "paths" as const,
        options: [],
        defaultAnswer: null,
        defaultFrom: null,
        candidates: ["src/auth/** : authentication and sessions", "src/billing/** : moves money"],
      },
      tail(),
    ]);

  it("shows them as rows, and ticks none of them", () => {
    // The question's own help says which code is dangerous is a human judgement.
    // Offering the shortlist spares the recall; ticking it would take the call.
    const s = withCandidates();
    const screen = renderInterview(s).join("\n");

    expect(screen).toContain("[ ] src/auth/**");
    expect(screen).toContain("[ ] src/billing/**");
    expect(answersOf(s).strictPaths).toEqual([]);
  });

  it("answers with the one that was ticked, and its reason", () => {
    const ticked = pressIn(withCandidates(), "space").state;

    expect(answersOf(ticked).strictPaths).toEqual([
      { glob: "src/auth/**", reason: "authentication and sessions" },
    ]);
  });

  it("keeps a drafted answer ticked and the candidates below it unticked", () => {
    const both = openInterview([
      {
        id: "strict-paths",
        prompt: "which paths",
        why: "because",
        kind: "paths" as const,
        options: [],
        defaultAnswer: "src/pay/** : moves money",
        defaultFrom: "draft" as const,
        candidates: ["src/auth/** : authentication and sessions"],
      },
      tail(),
    ]);
    const screen = renderInterview(both).join("\n");

    expect(screen).toContain("[x] src/pay/**");
    expect(screen).toContain("[ ] src/auth/**");
  });
});
