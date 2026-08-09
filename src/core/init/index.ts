/**
 * Layer 1 — `wst init`. The engine that reads a repo and decides what its `.sdd/`
 * should contain. PURE: facts in, file contents out. `src/commands/init.ts` does
 * the reading and the writing.
 *
 * The three things this module is responsible for, in the order they happen:
 *
 * 1. `detectStack` — everything the repo can answer about itself. Whatever the
 *    engine can KNOW it must not ask, and it must never infer a command that
 *    might not exist.
 * 2. `buildInterview` — the questions the repo could NOT answer, returned as data.
 *    Three of them by default.
 * 3. `planInit` — the generated payload, which must parse through the same
 *    loaders the rest of the engine uses and must not reference a single file
 *    that lives only in Whetstone.
 */

export type { CopyRequest, GeneratedFile } from "./artifact.js";
export { seedChecks, type SeedChecksOptions } from "./checks.js";
export {
  detectStack,
  type CommitStyle,
  type DetectedCommands,
  type Greenness,
  type PackageJson,
  type RepoFacts,
  type StackFacts,
} from "./detect.js";
export {
  NO_RISK,
  buildInterview,
  renderRiskProfile,
  riskIsElevated,
  validateAnswers,
  type InitQuestion,
  type InterviewAnswers,
  type QuestionId,
  type QuestionOption,
  type RiskProfile,
  type StrictPath,
} from "./interview.js";
export {
  ADR_TEMPLATE,
  CLAUDE_MD,
  MEMORY_README,
  SKILL_FILES,
  activeSkills,
  renderAgentsMd,
  renderConstitution,
  renderWstYaml,
  skillCopies,
} from "./payload.js";
export { planInit, type InitOptions, type InitPlan, type InitPlanInput } from "./plan.js";
export {
  auditSelfContained,
  formatViolations,
  type SelfContainmentViolation,
} from "./selfcontained.js";
export {
  buildTriageRules,
  renderClaudeSettings,
  renderStrictPathGuard,
  renderTriageRulesMd,
  renderTriageYaml,
} from "./triage.js";
export { collisionsIn, renderCollisions, type Collidable, type Collision } from "./collisions.js";
export {
  ProposalSchema,
  buildProposalPrompt,
  proposalToAnswers,
  renderProposal,
  unevidencedFlags,
  type Proposal,
} from "./propose.js";
