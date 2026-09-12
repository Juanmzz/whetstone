import { describe, expect, it } from "vitest";
import { auditSelfContained } from "./selfcontained.js";

const audit = (contents: string, extra: { files?: string[]; copies?: string[] } = {}) =>
  auditSelfContained({
    files: [
      { path: ".wst/constitution.md", contents },
      ...(extra.files ?? []).map((p) => ({ path: p, contents: "" })),
    ],
    copies: (extra.copies ?? []).map((to) => ({ from: to.replace(".wst/", ""), to, contents: "" })),
  });

describe("auditSelfContained — Whetstone's own files may never be referenced", () => {
  it("passes content that mentions nothing outside the target repo", () => {
    expect(audit("Run `npm test`. Log signals in `.wst/memory/signals.jsonl`.", {
      files: [".wst/memory/signals.jsonl"],
    })).toEqual([]);
  });

  it("catches a reference to a file under Whetstone's own docs/", () => {
    const found = audit("The schema is defined in docs/PARALLEL.md.");
    expect(found).toHaveLength(1);
    expect(found[0]?.match).toContain("docs/");
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
    expect(audit("Copy the eight files from Whetstone's `.wst/skills/`.").length).toBeGreaterThan(0);
  });

  it("reports the file and line, so the violation is fixable without a search", () => {
    const found = audit("line one\nline two\nsee docs/PARALLEL.md\n");
    expect(found[0]?.path).toBe(".wst/constitution.md");
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.why.length).toBeGreaterThan(0);
  });
});

describe("auditSelfContained — every .wst/ path named must be a path that gets created", () => {
  it("catches a reference to a .wst/ file the plan does not write", () => {
    const found = audit("Architecture lives in `docs/architecture.md`.");
    expect(found).toHaveLength(1);
    expect(found[0]?.match).toBe("docs/architecture.md");
  });

  it("accepts a reference to a file the plan does write", () => {
    expect(
      audit("The schema is in `.wst/memory/README.md`.", { files: [".wst/memory/README.md"] }),
    ).toEqual([]);
  });

  it("accepts a reference to a skill that is copied rather than generated", () => {
    expect(audit("See `.wst/skills/voice.md`.", { copies: [".wst/skills/voice.md"] })).toEqual([]);
  });

  it("accepts a directory reference", () => {
    expect(audit("Log a signal under `.wst/memory/receipts/`.")).toEqual([]);
  });

  it("accepts a placeholder or a glob", () => {
    expect(audit("Add `.wst/checks/<id>.md`, matched by `.wst/skills/**`.")).toEqual([]);
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
    expect(audit("It lives at `.wst/memory/README.md`.", { files: [".wst/memory/README.md"] }))
      .toEqual([]);
  });

  it("does not flag the target repo's own source paths", () => {
    expect(audit("`src/core/**` is strict here, and `src/shell/**` is not.")).toEqual([]);
  });
});

/**
 * The eight skills are COPIED verbatim, and until now they were the one thing
 * this audit never read. `input.copies` only widened the set of paths that count
 * as created; the loop was `for (const file of input.files)`. So the files most
 * likely to cite a Whetstone-only path — prose written for THIS repo, shipped
 * unchanged into someone else's — were the files nothing checked.
 */
describe("auditSelfContained — a citation by id is a reference too", () => {
  const copied = (contents: string) =>
    auditSelfContained({
      files: [{ path: ".wst/constitution.md", contents: "Nothing." }],
      copies: [{ from: "skills/recording.md", to: ".wst/skills/recording.md", contents }],
    });

  it("catches a decision id, which resolves to nothing in a fresh repo", () => {
    const found = copied("Made backend-agnostic per `adr-0001`.");

    expect(found).toHaveLength(1);
    expect(found[0]?.match).toBe("adr-0001");
  });

  it("catches the uppercase spelling too, since both are used", () => {
    expect(copied("Smart recall sits on top of them (ADR-0001).")).toHaveLength(1);
  });

  it("catches a SPEC section reference — SPEC is a Whetstone document", () => {
    const found = copied("Signals are append-only (SPEC §2.1).");

    expect(found).toHaveLength(1);
    expect(found[0]?.match).toContain("SPEC");
  });

  it("leaves a repo's own future ids alone — adr-0000 is the placeholder in a template", () => {
    expect(copied("Number your first decision `adr-0000`.")).toEqual([]);
  });
});

/**
 * Reference closure asks whether a named path will EXIST in the target repo.
 * "This run wrote it" was standing in for that, and the two came apart the first
 * time the payload referred to something the repo already had — a skill written
 * by hand, which AGENTS.md then listed and the audit called dangling.
 *
 * Written after review found the fix had no unit test: removing the one line
 * that merges `existing` left all 212 tests in this directory green.
 */
describe("auditSelfContained — a path that is already there", () => {
  const audit = (contents: string, existing?: readonly string[]) =>
    auditSelfContained({
      files: [{ path: ".wst/AGENTS-ish.md", contents }],
      copies: [],
      ...(existing === undefined ? {} : { existing }),
    });

  it("accepts a reference to a file this run did not write but the repo has", () => {
    expect(audit("See `.wst/skills/dispatch.md`.", [".wst/skills/dispatch.md"])).toEqual([]);
  });

  it("still rejects it when nothing says the file is there", () => {
    const found = audit("See `.wst/skills/dispatch.md`.");

    expect(found).toHaveLength(1);
    expect(found[0]?.match).toBe(".wst/skills/dispatch.md");
  });

  it("does not let `existing` wave through a different path", () => {
    // The hole worth guarding: a payload naming something that will NOT exist,
    // excused because a neighbouring file does.
    const found = audit("See `.wst/skills/absent.md`.", [".wst/skills/dispatch.md"]);

    expect(found).toHaveLength(1);
  });
});
