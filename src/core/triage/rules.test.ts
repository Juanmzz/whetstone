import { describe, expect, it } from "vitest";
import { classify } from "./classify.js";
import {
  DEFAULT_RULES,
  DEFAULT_RULES_YAML,
  parseTriageRules,
  TRIAGE_RULES_FORMAT,
} from "./rules.js";

const doc = (body: string): string => `version: ${TRIAGE_RULES_FORMAT}\nrules:\n${body}`;

const ONE_RULE = doc(
  [
    `  - glob: "src/core/**"`,
    `    tier: strict`,
    `    reason: the deterministic engine`,
  ].join("\n"),
);

describe("parseTriageRules", () => {
  it("parses a minimal document into rules", () => {
    expect(parseTriageRules(ONE_RULE)).toEqual([
      { glob: "src/core/**", tier: "strict", reason: "the deterministic engine" },
    ]);
  });

  it("preserves the order rules were written in", () => {
    // Order IS precedence (first-match-wins). A parser that sorted or de-duped
    // for tidiness would silently change every tier decision in the project.
    const rules = parseTriageRules(
      doc(
        [
          `  - {glob: "z/**", tier: off, reason: last}`,
          `  - {glob: "a/**", tier: strict, reason: first}`,
        ].join("\n"),
      ),
    );
    expect(rules.map((r) => r.glob)).toEqual(["z/**", "a/**"]);
  });

  it("rejects a rule with no reason", () => {
    // A rule that cannot say why it exists cannot be reviewed, and therefore
    // cannot be retired — it just accretes. `reason` is mandatory by contract.
    expect(() =>
      parseTriageRules(doc(`  - {glob: "src/**", tier: strict}`)),
    ).toThrow(/reason/i);
  });

  it("rejects a blank or whitespace-only reason", () => {
    expect(() =>
      parseTriageRules(doc(`  - {glob: "src/**", tier: strict, reason: "   "}`)),
    ).toThrow(/reason/i);
  });

  it("rejects an unknown tier", () => {
    expect(() =>
      parseTriageRules(doc(`  - {glob: "src/**", tier: paranoid, reason: why}`)),
    ).toThrow(/tier/i);
  });

  it("rejects an empty glob", () => {
    expect(() => parseTriageRules(doc(`  - {glob: "", tier: strict, reason: why}`))).toThrow(
      /glob/i,
    );
  });

  it("rejects two rules with the same glob", () => {
    // The second is unconditionally dead under first-match-wins, and a dead rule
    // is worse than a missing one: someone believes the project is covered.
    expect(() =>
      parseTriageRules(
        doc(
          [
            `  - {glob: "src/**", tier: strict, reason: first}`,
            `  - {glob: "src/**", tier: off, reason: shadowed}`,
          ].join("\n"),
        ),
      ),
    ).toThrow(/duplicate/i);
  });

  it("rejects an unknown top-level key rather than ignoring it", () => {
    // A typo'd key that parses fine is how a config silently does nothing.
    expect(() => parseTriageRules(`${ONE_RULE}\nrule:\n  - {}`)).toThrow();
  });

  it("rejects a document with no rules at all", () => {
    expect(() => parseTriageRules(`version: ${TRIAGE_RULES_FORMAT}\nrules: []`)).toThrow(/rule/i);
  });

  it("rejects a document from a future format version", () => {
    // Same reasoning as the receipt format tag: reading a v2 file with a v1
    // parser produces a plausible-looking, wrong ruleset.
    expect(() => parseTriageRules(`version: 99\nrules: []`)).toThrow(/version/i);
  });

  it("rejects empty or non-object input", () => {
    expect(() => parseTriageRules("")).toThrow();
    expect(() => parseTriageRules("- just\n- a\n- list")).toThrow();
    expect(() => parseTriageRules("::: not yaml :::\n  - [")).toThrow();
  });

  it("names its source in the error, so the operator knows which file is wrong", () => {
    expect(() => parseTriageRules("", "somewhere/triage.yaml")).toThrow(
      /somewhere\/triage\.yaml/,
    );
  });
});

/**
 * DEFAULT_RULES is derived by parsing DEFAULT_RULES_YAML, so the built-in
 * fallback and the text we ship as `.wst/triage.yaml` cannot drift apart. These
 * tests are the acceptance criteria for that YAML: they encode the table in
 * `.wst/triage-rules.md` as executable assertions.
 */
describe("the default ruleset", () => {
  const tierOf = (path: string): string =>
    classify([{ path, status: "modified" }], DEFAULT_RULES).tier;

  it("is the parse of the YAML we ship, with no second copy to drift", () => {
    expect(parseTriageRules(DEFAULT_RULES_YAML)).toEqual([...DEFAULT_RULES]);
  });

  it("gives every rule a reason a reviewer could act on", () => {
    for (const rule of DEFAULT_RULES) {
      expect(rule.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it("rates the deterministic engine strict", () => {
    expect(tierOf("src/core/triage/classify.ts")).toBe("strict");
    expect(tierOf("src/core/checks/schema.ts")).toBe("strict");
  });

  it("rates the payload that propagates verbatim strict", () => {
    expect(tierOf(".wst/skills/tdd-discipline.md")).toBe("strict");
  });

  /**
   * THE DEFAULTS TRAVEL. `DEFAULT_RULES_YAML` is what any repo without its own
   * `.wst/triage.yaml` is triaged by, so a path that exists only in Whetstone is
   * this project's biography imposed as another project's policy — the same class
   * of leak `core/init/selfcontained.ts` exists to stop, in the one file it does
   * not audit.
   *
   * It shipped: a `docs/` file sat here at `strict`, and the test above
   * asserted it, calling a Whetstone-only document "payload that propagates".
   */
  it("names no path that exists only in Whetstone", () => {
    const WHETSTONE_ONLY = [
      /docs\/woz\//,
      /\bOPEN_QUESTIONS\.md\b/,
      /\bPARALLEL\.md\b/,
      /\blanes\.yaml\b/,
      /\bVISION\.md\b/,
    ];
    for (const rule of DEFAULT_RULES) {
      for (const pattern of WHETSTONE_ONLY) {
        expect(`${rule.glob} ${rule.reason}`).not.toMatch(pattern);
      }
    }
  });

  it("rates compiled emitter output strict", () => {
    expect(tierOf(".claude/hooks/lane-guard.mjs")).toBe("strict");
  });

  it("rates the imperative shell and the commands light", () => {
    expect(tierOf("src/shell/git.ts")).toBe("light");
    expect(tierOf("src/commands/triage.ts")).toBe("light");
    expect(tierOf("src/cli.ts")).toBe("light");
  });

  it("rates non-propagating prose light", () => {
    expect(tierOf("README.md")).toBe("light");
    expect(tierOf("VISION.md")).toBe("light");
    expect(tierOf("AGENTS.md")).toBe("light");
    expect(tierOf("docs/PARALLEL.md")).toBe("light");
    expect(tierOf(".wst/memory/decisions.md")).toBe("light");
  });

  it("rates the retro log off", () => {
    expect(tierOf(".wst/memory/retro-log.md")).toBe("off");
  });

  it("falls back to light for anything it does not recognise", () => {
    expect(tierOf("some/unheard/of/file.txt")).toBe("light");
    expect(tierOf("package.json")).toBe("light");
  });

  it("does not let a broad rule shadow a stricter one", () => {
    // Guards the ordering of the shipped file itself: if a later edit hoists a
    // general `.wst/**` or `src/**` rule above the strict ones, this fails.
    expect(tierOf("src/core/gate/aggregate.ts")).toBe("strict");
    expect(tierOf(".wst/skills/voice.md")).toBe("strict");
  });
});
