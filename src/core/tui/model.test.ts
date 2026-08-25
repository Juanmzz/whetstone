import { describe, expect, it } from "vitest";
import { initialState, press, render, type TuiState } from "./model.js";

const START: TuiState = initialState({
  agent: "claude",
  skills: [
    { id: "skills/delegation.md", active: true },
    { id: "skills/lazy.md", active: true },
    { id: "skills/voice.md", active: false },
  ],
});

const at = (state: TuiState, keys: string[]): TuiState =>
  keys.reduce((s, k) => press(s, k).state, state);

describe("the menu", () => {
  it("opens on the menu, with nothing yet changed", () => {
    expect(START.view.kind).toBe("menu");
    expect(START.dirty).toBe(false);
  });

  it("moves the cursor and stops at the ends rather than wrapping", () => {
    // Wrapping in a three-item menu means `down` can land you where `up` would:
    // the cursor stops being a position and becomes a guess.
    expect(at(START, ["up"]).view.cursor).toBe(0);
    const bottom = at(START, ["down", "down", "down", "down", "down"]);
    expect(bottom.view.cursor).toBe(1);
  });

  it("opens the judge picker and comes back", () => {
    expect(at(START, ["return"]).view.kind).toBe("judge");
    expect(at(START, ["return", "escape"]).view.kind).toBe("menu");
  });

  it("opens the skills list", () => {
    expect(at(START, ["down", "return"]).view.kind).toBe("skills");
  });
});

describe("the judge picker", () => {
  const JUDGE = at(START, ["return"]);

  it("starts on whatever the config already says", () => {
    expect(render(JUDGE).join("\n")).toMatch(/claude/);
  });

  it("changes the judge and marks the state dirty", () => {
    const picked = at(JUDGE, ["down", "return"]);
    expect(picked.agent).toBe("gemini");
    expect(picked.dirty).toBe(true);
  });

  it("is not dirty after picking what was already selected", () => {
    // A save that rewrites the file with identical bytes still shows up as a
    // change in git, and then "wst touched my config" is a bug report.
    expect(at(JUDGE, ["return"]).dirty).toBe(false);
  });
});

describe("the skills list", () => {
  const SKILLS = at(START, ["down", "return"]);

  it("toggles the skill under the cursor", () => {
    const toggled = at(SKILLS, ["space"]);
    expect(toggled.skills[0]?.active).toBe(false);
    expect(toggled.dirty).toBe(true);
  });

  it("toggles back to where it started and is no longer dirty", () => {
    expect(at(SKILLS, ["space", "space"]).dirty).toBe(false);
  });

  it("shows which are on and which are off", () => {
    const text = render(SKILLS).join("\n");
    expect(text).toMatch(/[x×✓].*delegation/);
    expect(text).toMatch(/[ _·].*voice/);
  });
});

describe("leaving", () => {
  it("quits outright when nothing changed", () => {
    expect(press(START, "q").action).toEqual({ kind: "quit" });
  });

  it("asks before discarding a change rather than quitting silently", () => {
    const dirty = at(START, ["return", "down", "return"]);
    expect(press(dirty, "q").action).toEqual({ kind: "none" });
    expect(press(dirty, "q").state.view.kind).toBe("confirm");
  });

  it("saves what was changed", () => {
    const dirty = at(START, ["return", "down", "return"]);
    const saved = press(at(dirty, ["s"]), "").action;
    expect(press(dirty, "s").action).toEqual({
      kind: "save",
      agent: "gemini",
      skills: ["skills/delegation.md", "skills/lazy.md"],
    });
    void saved;
  });

  it("will not save when nothing changed", () => {
    expect(press(START, "s").action).toEqual({ kind: "none" });
  });
});
