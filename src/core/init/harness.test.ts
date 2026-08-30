import { describe, expect, it } from "vitest";
import { HARNESSES, judgeFor, pointersFor } from "./harness.js";

describe("HARNESSES — the catalogue a human picks from", () => {
  it("names every harness this project can put a front door in front of", () => {
    expect(HARNESSES.map((h) => h.id)).toEqual([
      "claude-code",
      "antigravity",
      "codex",
      "opencode",
    ]);
  });

  it("says of each whether it reads AGENTS.md on its own", () => {
    // The whole reason a pointer exists. Codex defined the AGENTS.md convention
    // and OpenCode follows it; neither needs a second file saying `@AGENTS.md`.
    const reads = HARNESSES.filter((h) => h.readsAgentsMd).map((h) => h.id);
    expect(reads).toEqual(["codex", "opencode"]);
  });
});

describe("pointersFor — a file per harness that cannot read AGENTS.md", () => {
  it("writes CLAUDE.md for Claude Code and nothing else", () => {
    expect(Object.keys(pointersFor(["claude-code"]))).toEqual(["CLAUDE.md"]);
  });

  it("writes both where both are used", () => {
    expect(Object.keys(pointersFor(["claude-code", "antigravity"]))).toEqual([
      "CLAUDE.md",
      "GEMINI.md",
    ]);
  });

  it("writes NOTHING for a harness that reads AGENTS.md already", () => {
    // The complaint this answers: `init` wrote GEMINI.md into a repo whose owner
    // does not use Gemini, and nobody was asked.
    expect(pointersFor(["codex", "opencode"])).toEqual({});
  });

  it("points at AGENTS.md rather than copying it, so there is one source of truth", () => {
    expect(pointersFor(["claude-code"])["CLAUDE.md"]).toBe("@AGENTS.md\n");
  });

  it("writes nothing when nobody was named, rather than guessing a harness", () => {
    expect(pointersFor([])).toEqual({});
  });

  it("ignores an id nobody ships instead of writing a file named after it", () => {
    expect(pointersFor(["not-a-harness" as never])).toEqual({});
  });
});

describe("judgeFor — which pick can actually run an llm check", () => {
  it("answers with the adapter a harness has, and null where there is none", () => {
    // Codex is a harness this repo writes for and CANNOT judge with: there is no
    // adapter. Offering it as a judge would offer a check that cannot run.
    expect(judgeFor(["claude-code"])).toBe("claude");
    expect(judgeFor(["antigravity"])).toBe("antigravity");
    expect(judgeFor(["opencode"])).toBeNull();
  });

  it("takes the first pick that has an adapter, so the order on screen decides", () => {
    expect(judgeFor(["opencode", "antigravity", "claude-code"])).toBe("antigravity");
  });

  it("answers null for no picks at all", () => {
    expect(judgeFor([])).toBeNull();
  });
});
