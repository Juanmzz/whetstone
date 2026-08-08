import { describe, expect, it } from "vitest";
import { auditSelfContained } from "./selfcontained.js";

const audit = (contents: string, extra: { files?: string[]; copies?: string[] } = {}) =>
  auditSelfContained({
    files: [
      { path: ".sdd/constitution.md", contents },
      ...(extra.files ?? []).map((p) => ({ path: p, contents: "" })),
    ],
    copies: (extra.copies ?? []).map((to) => ({ from: to.replace(".sdd/", ""), to })),
  });

describe("auditSelfContained — Whetstone's own files may never be referenced", () => {
  it("passes content that mentions nothing outside the target repo", () => {
    expect(audit("Run `npm test`. Log signals in `.sdd/memory/signals.jsonl`.", {
      files: [".sdd/memory/signals.jsonl"],
    })).toEqual([]);
  });

  it("catches a reference to Whetstone's Wizard-of-Oz docs", () => {
    const found = audit("The schema is defined in docs/woz/SPEC.md.");
    expect(found).toHaveLength(1);
    expect(found[0]?.match).toContain("docs/woz");
  });

  it("catches the exact bug that already happened here — a skill citing OPEN_QUESTIONS.md", () => {
    expect(audit("See OPEN_QUESTIONS.md for the open threads.").length).toBeGreaterThan(0);
  });

  it("catches `retro.md`, which the Wizard-of-Oz AGENTS.md template used to cite", () => {
    // The WoZ template said "run the retro (see `retro.md`)". That file is a
    // Whetstone document; in a bootstrapped repo the link dangles.
    expect(audit("Periodically run the retro (see `retro.md`).").length).toBeGreaterThan(0);
  });

  it("catches a possessive reference to Whetstone's own tree", () => {
    expect(audit("Copy the eight files from Whetstone's `.sdd/skills/`.").length).toBeGreaterThan(0);
  });

  it("reports the file and line, so the violation is fixable without a search", () => {
    const found = audit("line one\nline two\nsee docs/woz/init.md\n");
    expect(found[0]?.path).toBe(".sdd/constitution.md");
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.why.length).toBeGreaterThan(0);
  });
});

describe("auditSelfContained — every .sdd/ path named must be a path that gets created", () => {
  it("catches a reference to a .sdd/ file the plan does not write", () => {
    const found = audit("Architecture lives in `.sdd/architecture.md`.");
    expect(found).toHaveLength(1);
    expect(found[0]?.match).toBe(".sdd/architecture.md");
  });

  it("accepts a reference to a file the plan does write", () => {
    expect(
      audit("The schema is in `.sdd/memory/README.md`.", { files: [".sdd/memory/README.md"] }),
    ).toEqual([]);
  });

  it("accepts a reference to a skill that is copied rather than generated", () => {
    expect(audit("See `.sdd/skills/voice.md`.", { copies: [".sdd/skills/voice.md"] })).toEqual([]);
  });

  it("accepts a directory reference", () => {
    expect(audit("Add an ADR under `.sdd/memory/decisions/`.")).toEqual([]);
  });

  it("accepts a placeholder or a glob", () => {
    expect(audit("Add `.sdd/checks/<id>.md`, matched by `.sdd/skills/**`.")).toEqual([]);
  });

  it("applies the same closure to .claude/, which init also writes", () => {
    expect(audit("Wired in `.claude/hooks/strict-path-guard.mjs`.")).toHaveLength(1);
    expect(
      audit("Wired in `.claude/hooks/strict-path-guard.mjs`.", {
        files: [".claude/hooks/strict-path-guard.mjs"],
      }),
    ).toEqual([]);
  });

  it("is not fooled by trailing punctuation", () => {
    expect(audit("It lives at `.sdd/memory/README.md`.", { files: [".sdd/memory/README.md"] }))
      .toEqual([]);
  });

  it("does not flag the target repo's own source paths", () => {
    expect(audit("`src/core/**` is strict here, and `src/shell/**` is not.")).toEqual([]);
  });
});
