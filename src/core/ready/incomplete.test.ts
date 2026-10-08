import { describe, expect, it } from "vitest";
import { whyIncomplete, whyNothingToVerify, type IncompleteFacts } from "./incomplete.js";

const facts = (over: Partial<IncompleteFacts> = {}): IncompleteFacts => ({
  definitions: true,
  checks: 3,
  uncovered: [],
  errored: [],
  declined: [],
  unrun: [],
  ...over,
});

describe("whyIncomplete", () => {
  it("sends a repo with no .wst/ to init, and says nothing else", () => {
    const why = whyIncomplete(facts({ definitions: false, checks: 0, uncovered: ["src/a.ts"] }));

    expect(why).toContain("no .wst/");
    expect(why).toContain("`wst init`");
    expect(why).not.toContain("src/a.ts");
  });

  it("tells an empty registry apart from a missing one", () => {
    const why = whyIncomplete(facts({ checks: 0, uncovered: ["src/a.ts"] }));

    expect(why).toContain("init seeded no checks, or they were removed");
    expect(why).not.toContain("no .wst/");
  });

  it("lists the paths no check covers", () => {
    const why = whyIncomplete(facts({ uncovered: ["README.md", "docs/x.md"] }));

    expect(why).toBe("no check covers 2 changed paths, so nothing verified them: README.md, docs/x.md");
  });

  it("says one path in the singular", () => {
    expect(whyIncomplete(facts({ uncovered: ["README.md"] }))).toBe(
      "no check covers 1 changed path, so nothing verified it: README.md",
    );
  });

  it("stops at ten paths and counts the rest, so one sentence stays one sentence", () => {
    const many = Array.from({ length: 13 }, (_, i) => `docs/${String(i)}.md`);
    const why = whyIncomplete(facts({ uncovered: many }));

    expect(why).toContain("docs/9.md, and 3 more");
    expect(why).not.toContain("docs/10.md");
  });

  it("names a check that could not run, and whose fault that is", () => {
    const why = whyIncomplete(facts({ errored: ["test", "lint"] }));

    expect(why).toContain("2 checks could not run: test, lint");
    expect(why).toMatch(/not a verdict on this change/);
  });

  it("names a check that is switched off over these paths", () => {
    expect(whyIncomplete(facts({ declined: ["typecheck"] }))).toContain("switched off: typecheck");
  });

  it("names a blocking check that did not run, with what would run it", () => {
    const why = whyIncomplete(
      facts({ unrun: [{ id: "e2e", why: "left out by --fast", blocks: true }, { id: "review", why: "a model review, run with --lens", blocks: true }] }),
    );

    expect(why).toBe("2 checks that may block did not run: e2e (left out by --fast), review (a model review, run with --lens)");
  });

  it("does not blame an advisory check that did not run while something else is the cause", () => {
    const why = whyIncomplete(facts({ errored: ["test"], unrun: [{ id: "style", why: "left out by --fast", blocks: false }] }));

    expect(why).not.toContain("style");
  });

  it("names the advisory checks that did not run when nothing else ran either", () => {
    const why = whyIncomplete(facts({ unrun: [{ id: "review", why: "a model review, run with --lens", blocks: false }] }));

    expect(why).toBe("no check ran over this change, so nothing verified it. 1 check applied and did not run: review (a model review, run with --lens)");
  });

  it("puts a check that could not run ahead of paths nothing covers", () => {
    const lines = whyIncomplete(facts({ errored: ["test"], uncovered: ["README.md"] })).split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("could not run: test");
    expect(lines[1]).toBe("also, no check covers 1 changed path, so nothing verified it: README.md");
  });

  it("never returns nothing, since an unexplained INCOMPLETE is what this replaces", () => {
    expect(whyIncomplete(facts())).toBe("no check ran over this change, so nothing verified it");
  });
});

describe("whyNothingToVerify", () => {
  it("says a clean tree has no .wst/ either, so the silence is not mistaken for coverage", () => {
    expect(whyNothingToVerify(false)).toContain("`wst init`");
  });

  it("says nothing when the repo is set up", () => {
    expect(whyNothingToVerify(true)).toBeUndefined();
  });
});
