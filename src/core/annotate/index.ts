/**
 * Layer 5 — the annotated PR. The public face of this lane.
 *
 * The pipeline:
 *
 *   TriageResult ─┐
 *   GateVerdict  ─┼─> attributeFindings ─> annotate ─> renderBody / inlineComments
 *   Selection    ─┘                            │
 *                                              └─> writeProse (LLM, 🔴 only)
 *
 * THE RULE, in one line: **the tier is a FLOOR and a finding is the trigger** —
 * `criticality.ts` documents why `max(tier, finding)` destroys the signal this layer
 * exists to give. `naiveMaxCriticality` is deliberately NOT re-exported: it exists
 * only so the tests can demonstrate the failure, and nothing should be able to
 * import it by accident.
 */

export {
  CRITICALITIES,
  LABEL,
  MARK,
  criticalityFor,
  findingTrigger,
  joinCriticality,
  tierFloor,
  type Criticality,
} from "./criticality.js";

export {
  attributeFindings,
  type Attribution,
  type CheckCoverage,
  type Finding,
} from "./findings.js";

export {
  annotate,
  type AnnotateInput,
  type Annotation,
  type FileAnnotation,
  type ReviewEvent,
} from "./annotate.js";

export {
  BODY_END,
  BODY_START,
  fingerprint,
  inlineComments,
  pruneAlreadyPosted,
  renderBody,
  reviewSummary,
  shouldPostReview,
  upsertManagedBlock,
  type PostedComment,
  type RenderOptions,
  type ReviewComment,
  type ReviewSummary,
} from "./body.js";

export {
  PROSE_LENS,
  ProseSchema,
  writeProse,
  type Prose,
  type ProseRequest,
  type ProseResult,
} from "./prose.js";
