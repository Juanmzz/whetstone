/**
 * `planInit` — the whole of Layer 1 as one pure function.
 */

import { DEFAULT_AGENT } from "../config/schema.js";
import type { TriageRule } from "../contracts.js";
import { DEFINITION_DIR } from "../paths.js";
import { PRE_PUSH_PATH, renderPrePushHook } from "./hook.js";
import type { ClockPort } from "../ports.js";
import type { CopyRequest, GeneratedFile } from "./artifact.js";
import { seedChecks, seededChecks, type SeededCheck } from "./checks.js";
import type { Probes } from "./probe.js";
import { judgeFor, pointersFor, pointersForAgent } from "./harness.js";
import { detectStack, type RepoFacts, type StackFacts } from "./detect.js";
import { validateAnswers, type InterviewAnswers } from "./interview.js";
import {
  renderDecisionsMd,
  renderWstGitignore,
  renderWstGitattributes,
  MEMORY_README,
  OUT_OF_SCOPE_README,
  renderAgentsMd,
  renderConstitution,
  renderWstYaml,
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
  /**
   * Which harnesses read this repo. Decides the pointer files and nothing else.
   *
   * Omitted means every pointer, which is what `init` did before anyone was
   * asked: it wrote `GEMINI.md` into a repo whose owner uses Claude.
   */
  readonly harnesses?: readonly string[];
  /** Memory backend. `files` is the default AND the recommendation (ADR-0001). */
  readonly backend?: string;
  /** Seed an uncalibrated review lens. Off by default: apparatus is earned. */
  readonly seedAgentLens?: boolean;
  /** Emit `.claude/` hooks. On by default, but only when something is strict. */
}

export interface InitPlanInput {
  /**
   * What this repo's own commands did when the shell ran them, keyed by check id.
   * A seeded `block` rests on one of these; absent means nothing was measured.
   */
  readonly probes?: Probes;
  /** Check ids the human unticked on the plan screen. Seeded `enabled: false`. */
  readonly disabledChecks?: readonly string[];
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
  /** The checks this plan seeds, and what each would do. Offered before writing. */
  readonly checks: readonly SeededCheck[];
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
    ...(input.probes === undefined ? {} : { probes: input.probes }),
    ...(input.disabledChecks === undefined ? {} : { disabled: input.disabledChecks }),
    ...(options.seedAgentLens === true ? { agentLens: true } : {}),
  });

  // NONE. The readiness path reads no skill, so copying eight of them into a repo
  // installing verification is eight files nobody there has a use for yet.
  const copies: readonly CopyRequest[] = [];

  // Compiled BEFORE the prose, because the prose refers to it: `triage-rules.md`
  // may only name the hook in a repo where the hook actually exists.

  const constitution = renderConstitution({
    repoName: input.facts.repoName,
    date,
    purpose: input.answers.purpose,
    risk: input.answers.risk,
    detected: stack,
    declared: input.answers.stack,
  });
  const triageRulesMd = renderTriageRulesMd(rules, { date });

  /**
   * ONLY what selects and runs a readiness check.
   *
   * `init` used to write twenty-eight files: a constitution, a decision record, a
   * signal log, eight skills, two vendor pointers and a hook. A repo installing
   * verification for the first time had asked for none of them and could not yet
   * have a use for any: a signal log with no signals, a retro log with no retro, a
   * decision record with no decisions. Whetstone verifies a worktree; everything
   * else was apparatus arriving ahead of a need.
   */
  const files: GeneratedFile[] = [
    { path: `${DEFINITION_DIR}/triage.yaml`, contents: renderTriageYaml(rules) },
    {
      path: `${DEFINITION_DIR}/wst.yaml`,
      contents: renderWstYaml({ backend: options.backend ?? "files", namespace: input.facts.repoName }),
    },
    // The compiled check index, the event log and the receipts cache are per-machine
    // and must never be committed.
    { path: `${DEFINITION_DIR}/.gitignore`, contents: renderWstGitignore() },
    ...checkFiles,
  ];

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

  const checks = seededChecks(stack, {
    date,
    include: sourcePaths,
    ...(input.probes === undefined ? {} : { probes: input.probes }),
    ...(options.seedAgentLens === true ? { agentLens: true } : {}),
  });

  return { stack, rules, files, copies, notes, checks };
}
