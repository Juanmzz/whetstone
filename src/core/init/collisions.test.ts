import { describe, expect, it } from "vitest";
import type { CopyRequest, GeneratedFile } from "./artifact.js";
import { collisionsIn, type Collidable } from "./collisions.js";

const plan = (paths: readonly string[], copies: readonly string[] = []): Collidable => ({
  files: paths.map((path): GeneratedFile => ({ path, contents: "x" })),
  copies: copies.map((to): CopyRequest => ({ from: `skills/${to}`, to })),
});

describe("collisionsIn", () => {
  it("reports nothing when the repo is empty of everything planned", () => {
    expect(collisionsIn(plan([".wst/constitution.md", "AGENTS.md"]), [])).toEqual([]);
  });

  it("reports a planned file that already exists", () => {
    const found = collisionsIn(plan(["AGENTS.md"]), ["AGENTS.md"]);
    expect(found.map((c) => c.path)).toEqual(["AGENTS.md"]);
  });

  it("covers COPIES too, not just generated files", () => {
    // The skills are copied rather than generated, and a copy overwrites just as
    // hard. Guarding only `files` would leave half the payload unguarded.
    const found = collisionsIn(plan([], ["/.wst/skills/voice.md"]), ["/.wst/skills/voice.md"]);
    expect(found.map((c) => c.path)).toEqual(["/.wst/skills/voice.md"]);
  });

  it("ignores existing files the plan does not write", () => {
    expect(collisionsIn(plan(["AGENTS.md"]), ["README.md", "package.json"])).toEqual([]);
  });

  it("reports each colliding path once, even if planned twice", () => {
    const found = collisionsIn(plan(["AGENTS.md", "AGENTS.md"]), ["AGENTS.md"]);
    expect(found).toHaveLength(1);
  });

  it("orders collisions by path so two runs print the same list", () => {
    const found = collisionsIn(plan(["b.md", "a.md", "c.md"]), ["c.md", "a.md", "b.md"]);
    expect(found.map((c) => c.path)).toEqual(["a.md", "b.md", "c.md"]);
  });
});

/**
 * The stake is the whole point of the module.
 *
 * A bare list of paths tells the human WHAT is about to be destroyed but not what
 * it costs them, and the cost is wildly uneven: losing `.wst/memory/signals.jsonl`
 * is an empty file coming back empty, losing a hand-written `CLAUDE.md` is losing
 * work nothing else records. The refusal message has to let them tell those apart
 * without opening every file.
 */
describe("the stake attached to each collision", () => {
  it("warns that CLAUDE.md is replaced by a one-line pointer, not merged", () => {
    const [found] = collisionsIn(plan(["CLAUDE.md"]), ["CLAUDE.md"]);
    expect(found?.stake).toMatch(/one line|pointer/i);
  });

  it("warns that .claude/settings.json is replaced wholesale, not merged", () => {
    const [found] = collisionsIn(plan([".claude/settings.json"]), [".claude/settings.json"]);
    expect(found?.stake).toMatch(/permission|merge|wholesale|replaced/i);
  });

  it("warns that AGENTS.md becomes a generated artifact", () => {
    const [found] = collisionsIn(plan(["AGENTS.md"]), ["AGENTS.md"]);
    expect(found?.stake).toMatch(/generated/i);
  });

  it("gives an unrecognised path a stake rather than an empty string", () => {
    // A path added to the payload later must not silently print a blank reason.
    const [found] = collisionsIn(plan(["some/new/file.md"]), ["some/new/file.md"]);
    expect(found?.stake.trim()).not.toBe("");
  });
});

/**
 * `--force` may replace a generated file. It may not destroy evidence.
 *
 * `init` writes `signals.jsonl` empty, and `--force` overwrote it like anything
 * else — truncating a repo's append-only record to zero bytes. That was a
 * defensible call when the log was always empty at init; it stopped being one the
 * first time a real project had a day of signals in it. Constitution
 * non-negotiable 4: corrections are appended, never overwritten.
 *
 * Reported from a day of real use, alongside the workaround someone had to invent:
 * back up signals.jsonl, run `init --force`, restore it.
 */
describe("collisionsIn — what --force may never take", () => {
  const plan = {
    files: [
      { path: ".wst/memory/signals.jsonl", contents: "" },
      { path: ".wst/events.jsonl", contents: "" },
      { path: ".wst/constitution.md", contents: "x" },
    ],
    copies: [],
  };

  it("protects the event log where it actually lives", () => {
    // `.wst/events.jsonl`, not `.wst/memory/events.jsonl`. The first version
    // named the latter, so it guarded a path nothing writes.
    const [found] = collisionsIn(
      { files: [{ path: ".wst/events.jsonl", contents: "" }], copies: [] },
      [".wst/events.jsonl"],
    );

    expect(found?.forceable).toBe(false);
  });

  it("marks the append-only logs as unforceable", () => {
    const found = collisionsIn(plan, [".wst/memory/signals.jsonl", ".wst/events.jsonl"]);

    expect(found.map((c) => c.path)).toHaveLength(2);
    for (const c of found) expect(c.forceable).toBe(false);
  });

  it("leaves a generated file forceable, which is what --force is for", () => {
    const [found] = collisionsIn(plan, [".wst/constitution.md"]);

    expect(found?.forceable).toBe(true);
  });

  it("says what the log holds, not just that it collides", () => {
    const [found] = collisionsIn(plan, [".wst/memory/signals.jsonl"]);

    expect(found?.stake).toMatch(/append-only|never overwritten/i);
  });
});
