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
  it("opens on the menu, with nothing yet written", () => {
    expect(START.view.kind).toBe("menu");
    expect(START.wrote).toBeNull();
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

  it("writes the moment the judge is picked, rather than waiting to be told", () => {
    const picked = press(at(JUDGE, ["down"]), "return");
    expect(picked.state.agent).toBe("antigravity");
    expect(picked.action).toEqual({
      kind: "save",
      agent: "antigravity",
      skills: ["skills/delegation.md", "skills/lazy.md"],
    });
  });

  it("writes nothing when the judge picked is the one already set", () => {
    // A file rewritten with identical bytes is still a tool that touched a
    // config nobody asked it to.
    expect(press(JUDGE, "return").action).toEqual({ kind: "none" });
  });
});

describe("the skills list", () => {
  const SKILLS = at(START, ["down", "return"]);

  it("writes the moment a skill is toggled", () => {
    const toggled = press(SKILLS, "space");
    expect(toggled.state.skills[0]?.active).toBe(false);
    expect(toggled.action).toEqual({
      kind: "save",
      agent: "claude",
      skills: ["skills/lazy.md"],
    });
  });

  it("says which one it just wrote, since nothing else proves it happened", () => {
    expect(render(press(SKILLS, "space").state).join("\n")).toMatch(/wrote off: skills\/delegation/);
  });

  it("stops saying it the moment the cursor moves on", () => {
    expect(render(at(SKILLS, ["space", "down"])).join("\n")).not.toMatch(/wrote/);
  });

  it("shows which are on and which are off", () => {
    const text = render(SKILLS).join("\n");
    expect(text).toMatch(/[x×✓].*delegation/);
    expect(text).toMatch(/[ _·].*voice/);
  });
});

describe("leaving", () => {
  it("quits outright, since there is never anything unsaved to ask about", () => {
    expect(press(START, "q").action).toEqual({ kind: "quit" });
    const changed = at(START, ["return", "down", "return"]);
    expect(press(changed, "q").action).toEqual({ kind: "quit" });
  });

  it("carries the WHOLE settled state on every write, not the field just touched", () => {
    // The shell rewrites the file from this, so a partial payload would drop
    // whatever the previous keypress had set.
    const both = at(START, ["return", "down", "return", "down", "return"]);
    expect(press(both, "space").action).toMatchObject({ agent: "antigravity" });
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

  it("says nothing about a write before anything has been written", () => {
    expect(render(openSkills()).join("\n")).not.toMatch(/wrote/i);
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
