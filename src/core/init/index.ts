/**
 * Layer 1 — `wst init`. The engine that reads a repo and decides what its `.wst/`
 * should contain. PURE: facts in, file contents out. `src/commands/init.ts` does
 * the reading and the writing.
 */

export type { CopyRequest, GeneratedFile } from "./artifact.js";
export { seedChecks, type SeedChecksOptions } from "./checks.js";
export {
  detectStack,
  type DetectedCommands,
  type PackageJson,
  type RepoFacts,
  type StackFacts,
} from "./detect.js";
export {
  NO_RISK,
  AnswersSchema,
  buildInterview,
  type DraftedAnswers,
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
  renderDecisionsMd,
  renderRootGitignoreStanza,
  renderWstGitignore,
  renderWstGitattributes,
  CLAUDE_MD,
  VENDOR_POINTERS,
  MEMORY_README,
  ROOT_GITIGNORE_ENTRIES,
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
  unauditedCopies,
  type SelfContainmentViolation,
} from "./selfcontained.js";
export { MAX_DEPTH, MAX_FILES, skipDir, walkDepth } from "./walk.js";
export {
  buildTriageRules,
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
export {
  BASE_FILE,
  classifyUpdate,
  renderUpdate,
  parseBase,
  renderBase,
  type Disposition,
  type FileVerdict,
  type RecordedBase,
} from "./update.js";
