import { describe, expect, it } from "vitest";
import type { TriageRule } from "../contracts.js";
import {
  buildCharter,
  branchNameFor,
  strictPathsFrom,
  ORIENTATION_DOCS,
  type CharterInput,
} from "./charter.js";

const base: CharterInput = {
  task: "add a --quiet flag to wst status",
  worktreePath: "/tmp/wt/1/whetstone",
  branch: "run/quiet-flag",
  lane: null,
  gatingChecks: [
    { id: "typecheck", severity: "block", description: "TypeScript compiles." },
    { id: "test", severity: "block", description: "The suite passes." },
    { id: "correctness", severity: "warn", description: "No correctness bug." },
  ],
  strictPaths: ["src/core/", ".wst/skills/"],
  presentDocs: ["AGENTS.md", "CLAUDE.md", ".wst/architecture.md", ".wst/triage-rules.md"],
};

describe("buildCharter", () => {
  it("states the task and where to work", () => {
    const c = buildCharter(base);
    expect(c).toContain("add a --quiet flag to wst status");
    expect(c).toContain("/tmp/wt/1/whetstone");
    expect(c).toContain("run/quiet-flag");
  });

  // The point of a charter: the crewmate knows what will judge it BEFORE it
  // starts. A gate the worker cannot see is a trap, not a standard.
  it("tells the crewmate exactly what will gate the work", () => {
    const c = buildCharter(base);
    expect(c).toContain("typecheck");
    expect(c).toContain("test");
    expect(c).toContain("correctness");
  });

  it("distinguishes what can BLOCK from what only warns", () => {
    const c = buildCharter(base);
    const blockLine = c.split("\n").find((l) => l.includes("typecheck")) ?? "";
    const warnLine = c.split("\n").find((l) => l.includes("correctness")) ?? "";
    expect(blockLine.toLowerCase()).toContain("block");
    expect(warnLine.toLowerCase()).toContain("warn");
  });

  it("names the strict paths so the crewmate knows where TDD is mandatory", () => {
    const c = buildCharter(base);
    expect(c).toContain("src/core/");
    expect(c).toContain(".wst/skills/");
  });

  it("points at .wst/ rather than inlining it — progressive disclosure", () => {
    // Pasting the whole constitution into every crewmate prompt is the token
    // waste `token-economy` exists to stop. The charter is a map, not a copy.
    const c = buildCharter(base);
    expect(c).toContain("AGENTS.md");
    expect(c).toContain(".wst/");
    expect(c.length).toBeLessThan(4000);
  });

  it("includes the lane boundary when the crewmate is in a lane", () => {
    const c = buildCharter({ ...base, lane: "receipts" });
    expect(c).toContain("receipts");
    expect(c.toLowerCase()).toContain("lane");
  });

  it("omits lane talk entirely when there is no lane", () => {
    const c = buildCharter(base);
    expect(c.toLowerCase()).not.toContain("your lane");
  });

  it("forbids the crewmate from merging or pushing", () => {
    // The crewmate produces a diff; the gate and the human decide what happens
    // to it. A worker that can merge its own work has no gate.
    const c = buildCharter(base).toLowerCase();
    expect(c).toContain("do not merge");
    expect(c).toContain("push");
  });

  it("survives a task containing quotes and newlines", () => {
    const c = buildCharter({ ...base, task: 'fix the "weird" bug\nin parse.ts' });
    expect(c).toContain('fix the "weird" bug');
  });

  it("refuses an empty task rather than dispatching a crewmate with nothing to do", () => {
    expect(() => buildCharter({ ...base, task: "   " })).toThrow(/task/i);
  });
});

/**
 * OBSERVED IN THE FIELD (sig-0041). The first install into a repo Whetstone did not
 * grow up in — a payments API installed with `--definitions-only`
 * because its own harness already owns `AGENTS.md`.
 *
 * The charter it would have produced was authoritative and wrong in both halves: it
 * ordered the crewmate to read two files that do not exist there, and it named
 * Whetstone's OWN strict paths — three directories that repo does not have — while
 * saying nothing about `migrations/`, where its worst production incident happened.
 *
 * A charter naming the wrong paths is worse than one naming none, because it reads as
 * authoritative. So the charter may only name what the target actually has.
 */
describe("a charter for a repo Whetstone did not grow up in", () => {
  // What `wst init --definitions-only` leaves behind, and nothing more: no AGENTS.md
  // (the host harness owns that surface), no .wst/architecture.md (init never writes
  // one — it exists only in Whetstone's own repo).
  const foreignDocs = [".wst/constitution.md", ".wst/triage-rules.md", "CLAUDE.md"];

  const foreignRules: readonly TriageRule[] = [
    { glob: "migrations/**", tier: "strict", reason: "a bad migration is unrecoverable" },
    { glob: "src/**", tier: "strict", reason: "the Lambda handlers move money" },
    { glob: "docs/**", tier: "light", reason: "prose" },
  ];

  const charter = buildCharter({
    ...base,
    presentDocs: foreignDocs,
    strictPaths: strictPathsFrom(foreignRules),
  });

  it("names the strict paths THIS repo declared, not the ones Whetstone declares", () => {
    expect(charter).toContain("migrations/**");
    expect(charter).toContain("src/**");
  });

  it("names none of Whetstone's own strict paths in a repo that has none of them", () => {
    for (const whetstoneOnly of ["src/core/", ".wst/skills/", ".claude/hooks/"]) {
      expect(charter).not.toContain(whetstoneOnly);
    }
  });

  it("does not order the crewmate to read files this repo does not have", () => {
    expect(charter).not.toContain("AGENTS.md");
    expect(charter).not.toContain(".wst/architecture.md");
  });

  it("points at the orientation file this repo does have", () => {
    expect(charter).toContain("CLAUDE.md");
    expect(charter).toContain(".wst/constitution.md");
  });

  it("does not describe the target with facts that are only true of Whetstone", () => {
    // The old list explained architecture.md as "FCIS: core/ is pure and must never
    // import from shell/" — a fact about Whetstone, asserted about someone else's repo.
    expect(charter).not.toContain("FCIS");
    expect(charter).not.toContain("shell/");
  });

  // Whetstone's own repo must keep the charter it had: this is the false-positive half
  // of the guard [TD7]. A filter that drops everything is not a filter.
  it("still names AGENTS.md and architecture.md in a repo that has them", () => {
    const own = buildCharter(base);
    expect(own).toContain("AGENTS.md");
    expect(own).toContain(".wst/architecture.md");
  });

  // AGENTS.md and CLAUDE.md are one source of truth under ADR-0002 — CLAUDE.md is a
  // one-line `@AGENTS.md` import. Naming both sends the crewmate to the same content twice.
  it("names the canonical vendor file once when both AGENTS.md and CLAUDE.md exist", () => {
    const own = buildCharter(base);
    expect(own).toContain("AGENTS.md");
    expect(own.split("\n").filter((l) => l.startsWith("- `CLAUDE.md`"))).toEqual([]);
  });

  it("says so plainly rather than inventing a pointer when the repo has no orientation file", () => {
    const bare = buildCharter({ ...base, presentDocs: [] });
    expect(bare).not.toContain("AGENTS.md");
    expect(bare).not.toContain(".wst/triage-rules.md");
    expect(bare.toLowerCase()).toMatch(/no orientation/);
  });

  it("does not claim a strict tier exists when the triage rules declare none", () => {
    const nothingStrict = buildCharter({ ...base, strictPaths: [] });
    expect(nothingStrict).not.toContain("STRICT TIER — full TDD");
    expect(nothingStrict.toLowerCase()).toMatch(/nothing.*strict/);
  });
});

describe("strictPathsFrom", () => {
  const rules: readonly TriageRule[] = [
    { glob: "src/core/**", tier: "strict", reason: "the engine" },
    { glob: ".wst/memory/retro-log.md", tier: "off", reason: "a record" },
    { glob: "src/shell/**", tier: "light", reason: "thin adapters" },
    { glob: ".claude/hooks/**", tier: "strict", reason: "emitter output" },
  ];

  it("keeps the globs of the strict rules in the order the rules declare them", () => {
    expect(strictPathsFrom(rules)).toEqual(["src/core/**", ".claude/hooks/**"]);
  });

  it("drops every tier that is not strict", () => {
    expect(strictPathsFrom(rules)).not.toContain("src/shell/**");
    expect(strictPathsFrom(rules)).not.toContain(".wst/memory/retro-log.md");
  });

  it("returns nothing when a low-risk project declares nothing strict", () => {
    // `wst init` explicitly allows this and says so in its notes. The charter has to
    // survive it without asserting a discipline the project never adopted.
    expect(strictPathsFrom([{ glob: "docs/**", tier: "light", reason: "prose" }])).toEqual([]);
  });

  it("names a glob once even when two rules share it", () => {
    expect(
      strictPathsFrom([
        { glob: "src/**", tier: "strict", reason: "a" },
        { glob: "src/**", tier: "strict", reason: "b" },
      ]),
    ).toEqual(["src/**"]);
  });
});

describe("ORIENTATION_DOCS", () => {
  // The charter is a MAP. Every path it can print has to be one the caller can stat,
  // or the filter is decorative and the charter goes back to pointing at nothing.
  it("is the candidate set the composition root probes for", () => {
    expect(ORIENTATION_DOCS.map((d) => d.path)).toContain("AGENTS.md");
    expect(ORIENTATION_DOCS.map((d) => d.path)).toContain("CLAUDE.md");
    expect(ORIENTATION_DOCS.every((d) => d.note.trim() !== "")).toBe(true);
  });

  it("never renders a path the caller did not report as present", () => {
    const c = buildCharter({ ...base, presentDocs: [".wst/triage-rules.md"] });
    for (const doc of ORIENTATION_DOCS) {
      if (doc.path === ".wst/triage-rules.md") continue;
      expect(c).not.toContain(doc.path);
    }
  });
});

/**
 * OBSERVED IN THE WILD. `wst run` produced
 *   run/fix-init-see-monorepos-and-their-tests-i
 * where the trailing `-i` is the amputated start of a word: `slice(0, 40)` cut
 * mid-word and the `-+$` strip only removed a hyphen, never the stump.
 *
 * It reads as carelessness on a branch a human has to look at in `git branch`,
 * `gh pr list` and every merge commit forever. Cut at a word boundary instead.
 */
describe("branchNameFor truncation", () => {
  it("never ends in a fragment of a word", () => {
    expect(branchNameFor("fix init see monorepos and their tests inside packages")).toBe(
      "run/fix-init-see-monorepos-and-their-tests",
    );
  });

  it("cuts at the last word that fits, not at the character limit", () => {
    const name = branchNameFor("alpha bravo charlie delta echo foxtrot golf hotel india");
    expect(name.length).toBeLessThanOrEqual("run/".length + 40);
    // Every segment present must be a whole word from the input.
    const words = new Set("alpha bravo charlie delta echo foxtrot golf hotel india".split(" "));
    for (const part of name.slice("run/".length).split("-")) expect(words.has(part)).toBe(true);
  });

  it("falls back to a hard cut when the first word alone is too long", () => {
    // No word boundary to cut at. A stump beats an empty branch name.
    const name = branchNameFor("supercalifragilisticexpialidociousandthensomemoreletters");
    expect(name.startsWith("run/supercalifragilistic")).toBe(true);
    expect(name.length).toBeLessThanOrEqual("run/".length + 40);
  });

  it("still fits a short task unchanged", () => {
    expect(branchNameFor("add a quiet flag")).toBe("run/add-a-quiet-flag");
  });
});

describe("branchNameFor", () => {
  it("slugifies a task", () => {
    expect(branchNameFor("Add a --quiet flag to wst status")).toBe(
      "run/add-a-quiet-flag-to-wst-status",
    );
  });

  it("collapses punctuation instead of emitting an invalid ref", () => {
    // `git switch -C` rejects refs with .. // or a trailing dot; a naive slug
    // would produce them and the run would die after leasing a worktree.
    const b = branchNameFor("fix: parse.ts // handles ~weird~ input!!");
    expect(b).toMatch(/^run\/[a-z0-9-]+$/);
    expect(b).not.toContain("..");
    expect(b).not.toMatch(/-$/);
  });

  it("caps the length", () => {
    expect(branchNameFor("x".repeat(200)).length).toBeLessThanOrEqual(45);
  });

  it("falls back rather than producing a bare run/", () => {
    expect(branchNameFor("!!!")).toBe("run/task");
    expect(branchNameFor("...")).toBe("run/task");
  });

  it("never leaves a trailing hyphen after truncation", () => {
    // A 40-char cut can land on a hyphen; `run/foo-` is not a valid ref.
    for (const n of [39, 40, 41, 42]) {
      expect(branchNameFor(`${"ab ".repeat(n)}`)).not.toMatch(/-$/);
    }
  });
});

/**
 * The charter may not promise a barrier that is not there.
 *
 * Observed twice: a worker edited outside its lane on purpose, saw nothing stop
 * it, reverted, and stopped to ask. It obeyed the text — which is the good
 * outcome and not the one promised. The lane guard is emitted per repo with its
 * globs compiled in, so it exists in Whetstone and in no repo it bootstrapped.
 */
describe("buildCharter — the lane says what is true about it", () => {
  const withLane = (guard: boolean) =>
    buildCharter({ ...base, lane: "api", laneGuard: guard });

  it("says a hook denies the writes only where one does", () => {
    expect(withLane(true)).toMatch(/hook DENIES/);
  });

  it("asks rather than claims when nothing enforces it", () => {
    const charter = withLane(false);

    expect(charter).not.toMatch(/hook DENIES/);
    expect(charter).toMatch(/nothing here stops you|no hook/i);
  });

  it("still tells the worker to report a wrong split either way", () => {
    for (const guard of [true, false]) expect(withLane(guard)).toMatch(/STOP and report/);
  });
});
