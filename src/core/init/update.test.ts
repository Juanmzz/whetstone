/**
 * What `wst update` may say about a file, and why five answers and not two.
 *
 * adr-0006 wants a 3-way merge against a recorded base. This is the half that has to
 * exist first: without knowing whether a file is as `init` left it, update has only
 * bad moves — overwrite a human's edit, or never update anything.
 */

import { describe, expect, it } from "vitest";
import { activeSkills, renderConstitution } from "./payload.js";
import { detectStack } from "./detect.js";
import { NO_RISK } from "./interview.js";
import { classifyUpdate, parseBase, renderBase, renderUpdate, type RecordedBase } from "./update.js";

const H = {
  original: "a".repeat(64),
  edited: "b".repeat(64),
  renewed: "c".repeat(64),
};

const base = (files: Record<string, string>): RecordedBase => ({
  version: "0.5.0",
  generatedAt: "2026-01-01",
  answers: {
    purpose: "x",
    risk: { money: false, personalData: false, productionData: false, authn: false, safetyCritical: false, note: null },
    sourcePaths: ["src/**"],
    strictPaths: [],
    stack: null,
  },
  files,
});

const of = (verdicts: ReturnType<typeof classifyUpdate>, path: string): string | undefined =>
  verdicts.find((v) => v.path === path)?.disposition;

describe("classifyUpdate", () => {
  it("says nothing needs doing when the file is as init left it and init would write the same", () => {
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map([["a.md", H.original]]),
      expected: new Map([["a.md", H.original]]),
    });

    expect(of(verdicts, "a.md")).toBe("identical");
  });

  it("calls a hand-edited file DRIFTED, which is the whole reason the base exists", () => {
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map([["a.md", H.edited]]),
      expected: new Map([["a.md", H.original]]),
    });

    expect(of(verdicts, "a.md")).toBe("drifted");
  });

  it("prefers DRIFTED over OUTDATED when both are true, since the edit is the fact that costs", () => {
    // Whetstone renders it differently now AND a human changed it. Regenerating
    // would be silent data loss; saying "outdated" invites exactly that.
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map([["a.md", H.edited]]),
      expected: new Map([["a.md", H.renewed]]),
    });

    expect(of(verdicts, "a.md")).toBe("drifted");
  });

  it("calls an untouched file OUTDATED when this version would write it differently", () => {
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map([["a.md", H.original]]),
      expected: new Map([["a.md", H.renewed]]),
    });

    expect(of(verdicts, "a.md")).toBe("outdated");
  });

  it("reports a recorded file that is gone as MISSING rather than omitting it", () => {
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map(),
      expected: new Map([["a.md", H.original]]),
    });

    expect(of(verdicts, "a.md")).toBe("missing");
  });

  it("reports a file this version adds as NEW, so an upgrade is visible", () => {
    const verdicts = classifyUpdate({
      base: base({ "a.md": H.original }),
      onDisk: new Map([["a.md", H.original]]),
      expected: new Map([["a.md", H.original], ["b.md", H.renewed]]),
    });

    expect(of(verdicts, "b.md")).toBe("new");
  });

  it("reports a file nothing would write any more, rather than leaving it unexplained", () => {
    const verdicts = classifyUpdate({
      base: base({ "gone.md": H.original }),
      onDisk: new Map([["gone.md", H.original]]),
      expected: new Map(),
    });

    expect(of(verdicts, "gone.md")).toBe("orphan");
  });

  it("sorts by path, so two runs over the same repo read the same", () => {
    const verdicts = classifyUpdate({
      base: base({ "b.md": H.original, "a.md": H.original }),
      onDisk: new Map([["b.md", H.original], ["a.md", H.original]]),
      expected: new Map([["b.md", H.original], ["a.md", H.original]]),
    });

    expect(verdicts.map((v) => v.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("parseBase", () => {
  const written = renderBase({
    version: "0.5.0",
    generatedAt: "2026-01-01",
    answers: base({}).answers,
    files: { "a.md": H.original },
  });

  it("round-trips what recordBase wrote", () => {
    expect(parseBase(JSON.parse(written))).toEqual({
      version: "0.5.0",
      generatedAt: "2026-01-01",
      answers: base({}).answers,
      files: { "a.md": H.original },
    });
  });

  it("throws on a hash that is not one, rather than comparing garbage forever", () => {
    // A truncated or hand-typed hash never equals a real one, so every file it
    // covers would read as `drifted` and never be updatable again.
    expect(() => parseBase({ ...JSON.parse(written), files: { "a.md": "nope" } })).toThrow(
      /base\.json/,
    );
  });

  it("throws when the file is not a base at all", () => {
    expect(() => parseBase({ hello: true })).toThrow(/base\.json/);
  });

  it("writes JSON a human can read in a diff", () => {
    expect(written).toContain("\n  ");
    expect(written.endsWith("\n")).toBe(true);
  });
});

describe("renderUpdate", () => {
  const verdicts = classifyUpdate({
    base: base({ "kept.md": H.original, "mine.md": H.original, "old.md": H.original }),
    onDisk: new Map([["kept.md", H.original], ["mine.md", H.edited], ["old.md", H.original]]),
    expected: new Map([["kept.md", H.original], ["mine.md", H.original], ["old.md", H.renewed]]),
  });

  it("leads with what costs a decision, not with what is merely news", () => {
    const out = renderUpdate(verdicts);

    expect(out.indexOf("drifted")).toBeLessThan(out.indexOf("outdated"));
  });

  it("counts the untouched files instead of listing them", () => {
    // In a real repo they are most of the thirty, and printing them buries the two
    // lines somebody has to act on.
    const out = renderUpdate(verdicts);

    expect(out).toContain("1 file(s) are as init left them");
    expect(out).not.toContain("    kept.md");
  });

  it("says why each disposition matters, not only its name", () => {
    expect(renderUpdate(verdicts)).toContain("regenerating would lose that");
  });

  it("says so plainly when a base records nothing", () => {
    expect(renderUpdate([])).toContain("nothing to compare");
  });
});

/**
 * `update` re-plans from the recorded answers and calls the difference what an
 * upgrade would change. Two of its inputs were not the ones `init` used, so the
 * first run in a freshly bootstrapped repo reported two files as outdated whose
 * bytes on disk matched the hash the base itself recorded.
 */
describe("re-planning has to use the inputs init used", () => {
  it("an unread skills directory is not an empty one", () => {
    // `init` passes `undefined` when there is no directory yet; `update` passed
    // `[]`, which says it looked and found none. `init.ts` carries a comment
    // about exactly this: every bootstrapped repo got a config declaring all
    // eight skills INACTIVE while the files sat beside it.
    expect(activeSkills([])).toEqual([]);
    expect(activeSkills(undefined).length).toBeGreaterThan(0);
  });

  it("the recorded date is part of the answers, not of the day update runs", () => {
    // Anything the payload stamps with a date differs on any other day, and a
    // date that always differs hides the changes that matter.
    const then = renderConstitution({
      repoName: "acme",
      date: "2026-01-01",
      purpose: "p",
      risk: NO_RISK,
      detected: detectStack({
        repoName: "acme",
        files: [],
        packageJson: null,
        commitSubjects: [],
        contributors: null,
      }),
      declared: null,
    });

    expect(then).toContain("2026-01-01");
    expect(then).not.toContain(new Date().toISOString().slice(0, 10));
  });
});
