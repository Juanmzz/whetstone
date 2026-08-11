/**
 * `planInit` — the whole of Layer 1 as one pure function.
 *
 * Facts and answers in, a complete description of what the target repo should
 * contain out. Nothing here touches a filesystem, spawns a process or prints; the
 * composition root (`src/commands/init.ts`) does all three. That is what lets the
 * hard questions — does the generated triage document parse? does a fresh repo
 * get a check whose command does not exist? does anything reference a file that
 * only lives in Whetstone? — be answered by unit tests instead of by installing
 * into a scratch repo and reading it.
 *
 * The function REFUSES rather than degrades, in three places:
 *
 * - answers that do not validate (a blank purpose, an elevated risk profile that
 *   maps to no concrete path);
 * - generated content that references a path this init does not create;
 * - anything the deny-list recognises as a Whetstone-only artefact.
 *
 * All three produce a payload that looks installed and governs nothing, which is
 * strictly worse than a failed install: a failed install gets retried.
 */

import type { TriageRule } from "../contracts.js";
import { DEFINITION_DIR } from "../paths.js";
import type { ClockPort } from "../ports.js";
import type { CopyRequest, GeneratedFile } from "./artifact.js";
import { seedChecks } from "./checks.js";
import { detectStack, type RepoFacts, type StackFacts } from "./detect.js";
import { validateAnswers, type InterviewAnswers } from "./interview.js";
import {
  ADR_TEMPLATE,
  CLAUDE_MD,
  MEMORY_README,
  OUT_OF_SCOPE_README,
  activeSkills,
  renderAgentsMd,
  renderConstitution,
  renderWstYaml,
  skillCopies,
} from "./payload.js";
import { auditSelfContained, formatViolations } from "./selfcontained.js";
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

  const rules = buildTriageRules(stack, input.answers);
  const checkFiles = seedChecks(stack, {
    date,
    ...(options.seedAgentLens === true ? { agentLens: true } : {}),
  });

  const skills = activeSkills(stack);
  const copies = skillCopies();

  // Compiled BEFORE the prose, because the prose refers to it: `triage-rules.md`
  // may only name the hook in a repo where the hook actually exists.

  const constitution = renderConstitution({
    repoName: input.facts.repoName,
    date,
    purpose: input.answers.purpose,
    risk: input.answers.risk,
    conventions: input.answers.conventions,
    stack,
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
    ...checkFiles,
    { path: `${DEFINITION_DIR}/memory/README.md`, contents: MEMORY_README },
    // Empty on purpose. A seeded example would be the first line of the log, and
    // then every count, every "since the last retro" cursor and every cluster is
    // computed over a fact that never happened.
    { path: `${DEFINITION_DIR}/memory/signals.jsonl`, contents: "" },
    {
      path: `${DEFINITION_DIR}/memory/patterns.md`,
      contents:
        "# Patterns\n\nRecurring patterns distilled by a retro. Empty until one has run —" +
        "\nthis file holds conclusions, not observations.\n",
    },
    {
      path: `${DEFINITION_DIR}/memory/retro-log.md`,
      contents:
        "# Retro log\n\nOne entry per retro: which signals it read, what it changed, and what" +
        "\nit deliberately did not change. The next retro starts where the last one stopped.\n",
    },
    { path: `${DEFINITION_DIR}/memory/decisions/_TEMPLATE.md`, contents: ADR_TEMPLATE },
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
    // NOT a copy of AGENTS.md. Claude Code reads only CLAUDE.md but honours the
    // native `@path` import, so one source of truth costs one line here.
    { path: "CLAUDE.md", contents: CLAUDE_MD },
  ];
  if (options.definitionsOnly !== true) files.push(...vendorFiles);

  // No `.claude/` any more (ADR-0010). `init` writes DEFINITIONS; the editor hook is
  // the plugin's, which reads `.wst/triage.yaml` at run time rather than baking the
  // paths in, and composes with a repo's existing hooks instead of replacing their
  // `settings.json` wholesale. That write is what forced `collisions.ts` to exist.

  if (checkFiles.length === 0) {
    notes.push(
      "no checks were seeded: this repo declares no test, typecheck or lint command that " +
        "is certain to exist. A check whose command cannot run reports `errored` on every " +
        "change, which reads as a broken gate — so nothing was invented. Add one under " +
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
  // verbatim, so this catches the human's words as well as the generator's.
  const violations = auditSelfContained({ files, copies });
  if (violations.length > 0) {
    throw new Error(
      `the generated payload is NOT self-contained. Everything init writes travels into ` +
        `this repo and must stand alone; these references would dangle:\n` +
        `${formatViolations(violations)}`,
    );
  }

  return { stack, rules, files, copies, notes };
}
