import { describe, expect, it } from "vitest";
import { initialState, press, render, type TuiState } from "./model.js";

const START: TuiState = initialState({
  agent: "claude",
  skills: [
    { id: "skills/delegation.md", active: true, summary: "" },
    { id: "skills/lazy.md", active: true, summary: "" },
    { id: "skills/voice.md", active: false, summary: "" },
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
    expect(picked.agent).toBe("antigravity");
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
      agent: "antigravity",
      skills: ["skills/delegation.md", "skills/lazy.md"],
    });
    void saved;
  });

  it("will not save when nothing changed", () => {
    expect(press(START, "s").action).toEqual({ kind: "none" });
  });
});

describe("the skills screen answers what it is asking you to decide", () => {
  const withSkills = () =>
    initialState({
      agent: "claude",
      skills: [
        { id: "skills/voice.md", active: true, summary: "How the agent engages the human." },
        { id: "skills/lazy.md", active: true, summary: "" },
      ],
    });

  const openSkills = () => {
    const menu = press(press(withSkills(), "down").state, "return").state;
    return menu;
  };

  it("shows what the skill under the cursor governs, not only its filename", () => {
    // Eight filenames and nothing else meant opening each file to decide which
    // to switch off.
    const screen = render(openSkills()).join("\n");
    expect(screen).toContain("How the agent engages the human.");
  });

  it("says it for the row under the cursor and no other", () => {
    const screen = render(openSkills()).join("\n");
    expect(screen.split("How the agent engages").length - 1).toBe(1);
  });

  it("toggles on enter as well as on space, since enter is what people press", () => {
    const toggled = press(openSkills(), "return").state;
    expect(toggled.skills[0]?.active).toBe(false);
    expect(press(openSkills(), "space").state.skills[0]?.active).toBe(false);
  });

  it("says an edit is unsaved instead of waiting for the quit to mention it", () => {
    // `wst.yaml` is tracked, so the write is deliberate rather than per-keypress.
    // What was missing is any sign on screen that something is pending.
    const screen = render(press(openSkills(), "space").state).join("\n");
    expect(screen).toMatch(/unsaved/i);
  });

  it("says nothing about saving while nothing has changed", () => {
    expect(render(openSkills()).join("\n")).not.toMatch(/unsaved/i);
  });

  it("keeps every line inside a default terminal", () => {
    const long = initialState({
      agent: "claude",
      skills: [{ id: "skills/doc-locations.md", active: true, summary: "x".repeat(200) }],
    });
    const screen = press(press(long, "down").state, "return").state;
    for (const line of render(screen)) expect(line.length).toBeLessThanOrEqual(80);
  });
});
