/**
 * `planInit` — the whole of Layer 1 as one pure function.
 */

import type { TriageRule } from "../contracts.js";
import { DEFINITION_DIR } from "../paths.js";
import type { ClockPort } from "../ports.js";
import type { CopyRequest, GeneratedFile } from "./artifact.js";
import { seedChecks } from "./checks.js";
import { detectStack, type RepoFacts, type StackFacts } from "./detect.js";
import { validateAnswers, type InterviewAnswers } from "./interview.js";
import {
  renderDecisionsMd,
  renderWstGitignore,
  renderWstGitattributes,
  VENDOR_POINTERS,
  MEMORY_README,
  OUT_OF_SCOPE_README,
  activeSkills,
  renderAgentsMd,
  renderConstitution,
  renderWstYaml,
  skillCopies,
} from "./payload.js";
import { auditSelfContained, formatViolations, unauditedCopies } from "./selfcontained.js";
import {
  buildTriageRules,
  renderTriageRulesMd,
  renderTriageYaml,
} from "./triage.js";

export interface InitOptions {
  /**
   * Emit `.wst/` only: no `AGENTS.md`, no `CLAUDE.md`.
   *
   * `.wst/` is the vendor-neutral source of truth (ADR-0002) and the vendor files are
   * RENDERINGS of it. A repo that already has its own `AGENTS.md` — because another
   * harness owns that surface — needs the definitions without the rendering, and
   * refusing to install at all was the only previous answer.
   */
  readonly definitionsOnly?: boolean;
  /** Memory backend. `files` is the default AND the recommendation (ADR-0001). */
  readonly backend?: string;
  /** Seed an uncalibrated review lens. Off by default: apparatus is earned. */
  readonly seedAgentLens?: boolean;
  /** Emit `.claude/` hooks. On by default, but only when something is strict. */
}

export interface InitPlanInput {
  /**
   * Skills already on disk in the TARGET repo, repo-relative (`skills/x.md`).
   * Read by the shell. Absent on a fresh repo, where the shipped set is right.
   */
  readonly presentSkills?: readonly string[];
  /**
   * Whetstone's own skill files, keyed by `from`, read by the shell before
   * planning. Supplied so the reference-closure audit can read the eight files it
   * ships verbatim — the ones written for THIS repo and most likely to name a
   * path a bootstrapped repo does not have.
   */
  readonly skillTexts?: ReadonlyMap<string, string>;
  readonly facts: RepoFacts;
  readonly answers: InterviewAnswers;
  readonly clock: ClockPort;
  readonly options?: InitOptions;
}

export interface InitPlan {
  readonly stack: StackFacts;
  /** The triage rules, before rendering. The three renderings share this source. */
  readonly rules: readonly TriageRule[];
  readonly files: readonly GeneratedFile[];
  readonly copies: readonly CopyRequest[];
  /** What was inferred, and what init could NOT do. Printed for the human. */
  readonly notes: readonly string[];
}

function isoDate(clock: ClockPort): string {
  return clock.now().toISOString().slice(0, 10);
}

export function planInit(input: InitPlanInput): InitPlan {
  const errors = validateAnswers(input.answers);
  if (errors.length > 0) {
    throw new Error(
      `cannot generate ${DEFINITION_DIR}/ from these answers:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  const options = input.options ?? {};
  const date = isoDate(input.clock);
  const stack = detectStack(input.facts);
  const notes: string[] = [...stack.evidence];

  // Trimmed once, here, so the triage rules and the check `include` cannot end up
  // with different spellings of the same declared glob.
  const sourcePaths = input.answers.sourcePaths
    .map((glob) => glob.trim())
    .filter((glob) => glob.length > 0);

  const rules = buildTriageRules({ ...input.answers, sourcePaths });
  const checkFiles = seedChecks(stack, {
    date,
    include: sourcePaths,
    opinions: input.answers.opinions,
    ...(options.seedAgentLens === true ? { agentLens: true } : {}),
  });

  const skills = activeSkills(input.presentSkills);
  const copies = skillCopies(input.skillTexts);

  // Compiled BEFORE the prose, because the prose refers to it: `triage-rules.md`
  // may only name the hook in a repo where the hook actually exists.

  const constitution = renderConstitution({
    repoName: input.facts.repoName,
    date,
    purpose: input.answers.purpose,
    risk: input.answers.risk,
    conventions: input.answers.conventions,
    detected: stack,
    declared: input.answers.stack,
  });
  const triageRulesMd = renderTriageRulesMd(rules, { date });

  const files: GeneratedFile[] = [
    { path: `${DEFINITION_DIR}/constitution.md`, contents: constitution },
    { path: `${DEFINITION_DIR}/triage-rules.md`, contents: triageRulesMd },
    { path: `${DEFINITION_DIR}/triage.yaml`, contents: renderTriageYaml(rules) },
    {
      path: `${DEFINITION_DIR}/wst.yaml`,
      contents: renderWstYaml({
        backend: options.backend ?? "files",
        skills,
        namespace: input.facts.repoName,
      }),
    },
    // Per-machine runtime state (the compiled check index, the event log, the
    // receipts cache) must never be committed. `memory/signals.jsonl` below is
    // NOT covered here on purpose: it is committed, deliberately.
    { path: `${DEFINITION_DIR}/.gitignore`, contents: renderWstGitignore() },
    // How git merges the one committed page every worker appends to at once.
    // N worktrees on one repository; without this, every second worker
    // conflicts on the last line of the signal log.
    { path: `${DEFINITION_DIR}/.gitattributes`, contents: renderWstGitattributes() },
    ...checkFiles,
    { path: `${DEFINITION_DIR}/memory/README.md`, contents: MEMORY_README },
    // Empty on purpose. A seeded example would be the first line of the log, and
    // then every count, every "since the last retro" cursor and every cluster is
    // computed over a fact that never happened.
    { path: `${DEFINITION_DIR}/memory/signals.jsonl`, contents: "" },
    {
      path: `${DEFINITION_DIR}/memory/patterns.md`,
      contents:
        "# Patterns\n\nRecurring patterns distilled by a retro. Empty until one has run," +
        "\nthis file holds conclusions, not observations.\n",
    },
    {
      path: `${DEFINITION_DIR}/memory/retro-log.md`,
      contents:
        "# Retro log\n\nOne entry per retro: which signals it read, what it changed, and what" +
        "\nit deliberately did not change. The next retro starts where the last one stopped.\n",
    },
    { path: `${DEFINITION_DIR}/memory/decisions.md`, contents: renderDecisionsMd({ date }) },
    // No entries, only the home. A seeded refusal would be a decision nobody made,
    // and it would be read as one — the same reason `signals.jsonl` ships empty.
    { path: `${DEFINITION_DIR}/memory/out-of-scope/README.md`, contents: OUT_OF_SCOPE_README },
  ];

  // The vendor files are RENDERINGS of `.wst/` (ADR-0002), which is why they can be
  // withheld without withholding anything: a repo whose harness already owns
  // `AGENTS.md` gets the definitions and keeps its own front door. Refusing to
  // install at all used to be the only answer to that.
  const vendorFiles: GeneratedFile[] = [
    {
      path: "AGENTS.md",
      contents: renderAgentsMd({
        repoName: input.facts.repoName,
        constitution,
        triageRulesMd,
        activeSkills: skills,
        checkIds: checkFiles.map((f) =>
          f.path.replace(`${DEFINITION_DIR}/checks/`, "").replace(/\.md$/, ""),
        ),
      }),
    },
    // NOT copies of AGENTS.md: a pointer, so there is one source of truth.
    ...Object.entries(VENDOR_POINTERS).map(([path, contents]) => ({ path, contents })),
  ];
  if (options.definitionsOnly !== true) files.push(...vendorFiles);

  // No `.claude/` any more (ADR-0010). `init` writes DEFINITIONS; the editor hook is
  // the plugin's, which reads `.wst/triage.yaml` at run time rather than baking the
  // paths in, and composes with a repo's existing hooks instead of replacing their
  // `settings.json` wholesale. That write is what forced `collisions.ts` to exist.

  // Two different silences, and telling them apart is the difference between "add
  // a test script" and "answer the question you skipped".
  if (checkFiles.length === 0 && sourcePaths.length === 0) {
    notes.push(
      "no checks were seeded: no source path was named, so a check would have nothing to " +
        "put in its `include` but `**`: which covers build output and vendored code and " +
        "still misses every dotfile. Re-run naming where the code lives, or add a check " +
        `under \`${DEFINITION_DIR}/checks/\` by hand.`,
    );
  } else if (checkFiles.length === 0) {
    notes.push(
      "no checks were seeded: this repo declares no test, typecheck or lint command that " +
        "is certain to exist. A check whose command cannot run reports `errored` on every " +
        "change, which reads as a broken gate, so nothing was invented. Add one under " +
        `\`${DEFINITION_DIR}/checks/\` once the project has a runner.`,
    );
  }

  if (input.answers.strictPaths.length === 0) {
    notes.push(
      "nothing is strict yet. That is a legitimate answer for a low-risk project, but " +
        "revisit it the moment a path exists where a bug is expensive.",
    );
  }

  // ADR-0004, enforced. Free text from the interview flows into the constitution
  // verbatim, so this catches the human's words as well as the generator's — and
  // the copied skills, which are prose written for Whetstone's own repo.
  const unaudited = unauditedCopies(copies);
  if (unaudited.length > 0) {
    // A note, not a violation: the audit could not run on these, which is not the
    // same as their being clean, and not the same as their being broken.
    notes.push(
      `${String(unaudited.length)} copied file(s) were NOT audited for self-containment: ` +
        `their text could not be read: ${unaudited.join(", ")}`,
    );
  }

  const violations = auditSelfContained({
    files,
    copies,
    existing: (input.presentSkills ?? []).map((p) => `${DEFINITION_DIR}/${p}`),
  });
  if (violations.length > 0) {
    throw new Error(
      `the generated payload is NOT self-contained. Everything init writes travels into ` +
        `this repo and must stand alone; these references would dangle:\n` +
        `${formatViolations(violations)}`,
    );
  }

  return { stack, rules, files, copies, notes };
}
