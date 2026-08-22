import { describe, expect, it } from "vitest";
import type { RepoFacts, StackFacts } from "./detect.js";
import {
  ProposalSchema,
  buildProposalPrompt,
  proposalToAnswers,
  renderProposal,
  unevidencedFlags,
  type Proposal,
} from "./propose.js";

const facts: RepoFacts = {
  repoName: "sift-app",
  files: ["apps/api/src/routes/webhooks.ts", "apps/api/src/db/migrations/003.sql", "README.md"],
  packageJson: { scripts: { test: "vitest run", lint: "eslint ." } },
  commitSubjects: ["feat: daily rollover", "fix(api): cursor pagination"],
  contributors: 1,
};

const stack: StackFacts = {
  packageManager: "npm",
  commands: { test: "npm run test", typecheck: null, lint: "npm run lint" },
  hasTests: true,
  mutating: [],
  evidence: ["package manager: npm (from package-lock.json)"],
};

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  purpose: "A personal task manager with quick capture and daily review.",
  purposeEvidence: "README.md describes capture and review; apps/bot is a Telegram capture path.",
  stack: "TypeScript on Node, Vitest, and a CI workflow.",
  sourcePaths: ["apps/*/src/**"],
  risk: [],
  strictPaths: [],
  ...over,
});

/**
 * Found on the FIRST live run: given only a file list, the judge correctly refused
 * to guess and then told us exactly what it was missing — "I was not shown the
 * contents of package.json or src/a.ts, which are the two things most likely to
 * settle purpose". A hermetic judge cannot go and get them, so we hand them over.
 *
 * README and dependency names, not source. The README is a project stating its own
 * intent, and the dependency list is what it actually reaches for; both are small.
 * Inlining source would multiply the cost of a command that runs once.
 */
describe("what the first live run proved was missing", () => {
  it("inlines the README when there is one", () => {
    const prompt = buildProposalPrompt(facts, stack, "# sift\n\nCaptura rápida de tareas.");
    expect(prompt).toContain("Captura rápida de tareas");
  });

  it("inlines dependency names, which say what the project reaches for", () => {
    const withDeps: RepoFacts = {
      ...facts,
      packageJson: { ...facts.packageJson, dependencies: { fastify: "^5", "node-telegram-bot-api": "^1" } },
    };
    expect(buildProposalPrompt(withDeps, stack)).toContain("node-telegram-bot-api");
  });

  it("says the README is absent rather than staying silent about it", () => {
    // Silence reads as "there was nothing worth showing you". The judge should know
    // the difference between a repo with no README and a README we failed to pass.
    expect(buildProposalPrompt(facts, stack)).toMatch(/README.*(none|absent|not found)/i);
  });
});

describe("buildProposalPrompt", () => {
  /**
   * THE HERMETIC CONSTRAINT (hard rule 9). The judge runs with `--tools ""` and no
   * filesystem, so it cannot open a single file. Anything it must reason over has to
   * be IN the prompt. A prompt that says "look at the repo" produces a confident
   * answer about a repo the model never saw, which is the worst possible output:
   * indistinguishable from a real one.
   */
  it("inlines the file list, since the judge cannot read the repo", () => {
    const prompt = buildProposalPrompt(facts, stack);
    expect(prompt).toContain("apps/api/src/routes/webhooks.ts");
    expect(prompt).toContain("apps/api/src/db/migrations/003.sql");
  });

  it("inlines the package scripts and the commit subjects", () => {
    const prompt = buildProposalPrompt(facts, stack);
    expect(prompt).toContain("vitest run");
    expect(prompt).toContain("feat: daily rollover");
  });

  it("inlines what was READ off the repo, with the file it came from", () => {
    const prompt = buildProposalPrompt(facts, stack);
    expect(prompt).toContain("package manager: npm (from package-lock.json)");
    expect(prompt).toContain("tests present: yes");
  });

  /**
   * The prompt used to open with `language: TypeScript`, decided by counting file
   * extensions. Handing the judge a guess dressed as a fact is worse than handing
   * it nothing: it anchors the answer on the table's mistake, and the judge has
   * the file list right there and can do better than the table.
   */
  it("asserts no language of its own — it asks the judge for one", () => {
    const prompt = buildProposalPrompt(facts, stack);
    expect(prompt).not.toMatch(/^language: /m);
    expect(prompt).toMatch(/stack/i);
  });

  it("asks where the code lives, from the file list it was given", () => {
    expect(buildProposalPrompt(facts, stack)).toContain("sourcePaths");
  });

  it("never instructs the judge to read, open or explore anything", () => {
    // A hermetic judge told to "read the README" cannot, and will invent one.
    expect(buildProposalPrompt(facts, stack)).not.toMatch(/\b(read|open|explore|inspect) the\b/i);
  });
});

/**
 * THE RULE THIS MODULE EXISTS FOR: evidence over assertion.
 *
 * The whole tool is built on refusing to take a claim at face value — receipts,
 * calibration, the hermetic judge. A proposal that says `money: true` with nothing
 * cited is exactly the assertion the project refuses everywhere else, and it would
 * arrive dressed as a finding.
 *
 * So a risk flag without a cited path is DROPPED, and reported as dropped. The
 * human is told the model wanted to raise it and could not say why.
 */
describe("a risk flag must carry evidence or it does not count", () => {
  const withRisk = (over: Partial<Proposal["risk"][number]>) =>
    proposal({
      risk: [{ flag: "money", why: "handles payments", citedPaths: ["apps/api/src/routes/webhooks.ts"], ...over }],
    });

  it("keeps a flag that cites a path", () => {
    expect(proposalToAnswers(withRisk({})).risk.money).toBe(true);
  });

  it("DROPS a flag that cites nothing", () => {
    expect(proposalToAnswers(withRisk({ citedPaths: [] })).risk.money).toBe(false);
  });

  it("reports what it dropped rather than swallowing it", () => {
    const dropped = unevidencedFlags(withRisk({ citedPaths: [] }));
    expect(dropped).toContain("money");
  });

  it("reports nothing when every flag is evidenced", () => {
    expect(unevidencedFlags(withRisk({}))).toEqual([]);
  });

  it("leaves every unmentioned flag false", () => {
    const answers = proposalToAnswers(withRisk({}));
    expect(answers.risk.personalData).toBe(false);
    expect(answers.risk.safetyCritical).toBe(false);
  });
});

describe("proposalToAnswers", () => {
  it("selects no opinion, because a model may not answer that question", () => {
    // An opinion is written on a human yes and on nothing else (adr-0025). A draft
    // that arrived with one pre-selected would be the model deciding, and the
    // review step exists precisely so it does not.
    expect(proposalToAnswers(proposal()).opinions).toEqual([]);
  });

  it("produces answers a strict AnswersSchema will accept — no reasoning leaks in", () => {
    const answers = proposalToAnswers(proposal());
    expect(Object.keys(answers).sort()).toEqual([
      "conventions",
      "opinions",
      "purpose",
      "risk",
      "sourcePaths",
      "stack",
      "strictPaths",
    ]);
    expect(JSON.stringify(answers)).not.toContain("Evidence");
  });

  it("carries the stack and the source paths through — they are answers now, not guesses", () => {
    const answers = proposalToAnswers(proposal());
    expect(answers.stack).toBe("TypeScript on Node, Vitest, and a CI workflow.");
    expect(answers.sourcePaths).toEqual(["apps/*/src/**"]);
  });

  it("carries a strict path's reason through, since a rule that cannot say why cannot be retired", () => {
    const answers = proposalToAnswers(
      proposal({ strictPaths: [{ glob: "apps/api/src/db/**", reason: "destructive migrations" }] }),
    );
    expect(answers.strictPaths).toEqual([
      { glob: "apps/api/src/db/**", reason: "destructive migrations" },
    ]);
  });
});

describe("renderProposal", () => {
  it("shows the reasoning, which is the whole point of proposing rather than deciding", () => {
    const out = renderProposal(
      proposal({ risk: [{ flag: "money", why: "payment callbacks", citedPaths: ["apps/api/src/routes/webhooks.ts"] }] }),
    );
    expect(out).toContain("payment callbacks");
    expect(out).toContain("apps/api/src/routes/webhooks.ts");
  });

  it("says plainly that the human owns the risk answer", () => {
    // ADR-0003: the human gate is the moat. A draft that reads as a verdict invites
    // someone to accept it unread, which is the failure this whole flow exists to avoid.
    expect(renderProposal(proposal())).toMatch(/your call|you decide|review|confirm/i);
  });
});

describe("ProposalSchema", () => {
  it("rejects a risk entry with no `why`, so the judge cannot return a bare flag", () => {
    const bad = {
      purpose: "x",
      purposeEvidence: "y",
      stack: "z",
      sourcePaths: [],
      risk: [{ flag: "money", citedPaths: [] }],
      strictPaths: [],
    };
    expect(ProposalSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown risk flag rather than passing it through", () => {
    const bad = {
      purpose: "x",
      purposeEvidence: "y",
      stack: "z",
      sourcePaths: [],
      risk: [{ flag: "vibes", why: "z", citedPaths: ["a.ts"] }],
      strictPaths: [],
    };
    expect(ProposalSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a well-formed proposal", () => {
    expect(ProposalSchema.safeParse(proposal()).success).toBe(true);
  });

  it("rejects a proposal that skips the stack — it is asked for, not optional", () => {
    const { stack: _dropped, ...rest } = proposal();
    expect(ProposalSchema.safeParse(rest).success).toBe(false);
  });
});
