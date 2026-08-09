/**
 * The ONE piece of judgment in Layer 5 — "look here **because X**". PURE in the
 * `core/orchestrate/` sense: the `LlmJudge` arrives as a PARAMETER, so this module
 * never imports an adapter and is fully testable with a fake.
 *
 * ## The division of labour, which is the whole design
 *
 * | Written by the ENGINE (free, deterministic, always) | Written by the LLM (billed, 🔴 only) |
 * |---|---|
 * | which files changed, and their tier | why a human should look at THIS red file |
 * | criticality: 🔴 / 🟡 / ⚪ | |
 * | which check failed, and its raw detail | |
 * | not-verified and receipt notes | |
 * | the whole PR body and its structure | |
 * | `REQUEST_CHANGES` vs `COMMENT` | |
 *
 * Nothing the LLM says can change a colour, a count, or the review event. It writes
 * one sentence per red file and that is all — which is why a judge that times out
 * costs the reviewer nuance and never the annotation. `writeProse` NEVER throws and
 * NEVER rejects; failure is a field.
 *
 * ## Frugality
 *
 * Zero red files means zero calls and zero cost — the common case on a clean PR.
 * When there are red files it is ONE call for all of them, not one per file: the
 * model needs the whole picture to say which of three failures is the real one, and
 * N calls would cost N times as much to know less.
 */

import { z } from "zod";
import type { LlmJudge, ModelTier } from "../ports.js";
import type { Annotation } from "./annotate.js";

/**
 * What the judge must return. `why` is `min(1)` for the same reason
 * `LensVerdictSchema.reason` is: prose that says nothing is worse than no prose,
 * because it occupies the slot a reviewer looks at.
 */
export const ProseSchema = z.object({
  items: z.array(
    z.object({
      path: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
});

export type Prose = z.infer<typeof ProseSchema>;

/**
 * The lens. Appended to the system prompt, never replacing it — replacing it is what
 * made the model leak tool-call markup into schema-valid fields (`.sdd/architecture.md`).
 *
 * It is written to constrain the model to the one job it has here. In particular it
 * is told NOT to re-report the finding: the raw check output is already in the
 * comment directly above whatever it writes, and a model paraphrasing it produces
 * confident-sounding duplication that pushes the real text off the screen.
 */
export const PROSE_LENS = [
  "You are annotating a pull request for a human reviewer who has limited time.",
  "For each file listed, write ONE sentence saying WHY a human should look at this",
  "specific file — what could be wrong, or what judgement call needs a second pair of",
  "eyes. Point at the mechanism, not at the symptom.",
  "",
  "Rules:",
  "- Do NOT restate the check output; the reviewer can already see it.",
  "- Do NOT speculate about files you were not shown.",
  "- If you have nothing useful to add for a file, omit it entirely.",
  "- One sentence. No preamble, no markdown, no code fences.",
].join("\n");

export interface ProseRequest {
  readonly annotation: Annotation;
  /** The unified diff, when the caller has it. Improves the prose; not required. */
  readonly diff?: string;
  readonly model?: ModelTier;
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
}

export interface ProseResult {
  /** Keyed by path. Only ever contains paths that are 🔴 in the annotation. */
  readonly prose: ReadonlyMap<string, string>;
  readonly costUsd: number;
  /** Set when the judge could not answer. The annotation is unaffected. */
  readonly error?: string;
}

function buildPrompt(request: ProseRequest, red: Annotation["files"]): string {
  const sections = red.map((file) => {
    const findings = file.findings
      .map((finding) => `  - ${finding.checkId}: ${finding.detail}`)
      .join("\n");
    return `### ${file.path} (${file.tier} tier)\n${findings}`;
  });

  const parts = [
    `A ${request.annotation.tier}-tier change. ${String(red.length)} file(s) need a human's attention:`,
    "",
    ...sections,
  ];

  if (request.diff !== undefined && request.diff.trim() !== "") {
    parts.push("", "The diff:", "", request.diff);
  }

  return parts.join("\n");
}

export async function writeProse(request: ProseRequest, judge: LlmJudge): Promise<ProseResult> {
  const red = request.annotation.files.filter((file) => file.criticality === "review");

  // Zero red, zero calls, zero cost. The common case must be free.
  if (red.length === 0) return { prose: new Map(), costUsd: 0 };

  let result;
  try {
    result = await judge.judge({
      lens: PROSE_LENS,
      prompt: buildPrompt(request, red),
      schema: ProseSchema,
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(request.maxBudgetUsd !== undefined ? { maxBudgetUsd: request.maxBudgetUsd } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });
  } catch (cause) {
    // An adapter that rejects must not take the annotation down with it. The
    // engine's reasons are already written; this was the optional part.
    return {
      prose: new Map(),
      costUsd: 0,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (!result.ok) {
    return {
      prose: new Map(),
      costUsd: result.costUsd,
      error: `${result.error.kind}: ${result.error.detail}`,
    };
  }

  // Only paths that are actually red. A model that names a file it was not shown is
  // writing about code it has not seen, and that sentence would be pinned to a real
  // line in someone's review.
  const allowed = new Set(red.map((file) => file.path));
  const prose = new Map<string, string>();
  for (const item of (result.value as Prose).items) {
    if (!allowed.has(item.path)) continue;
    const why = item.why.trim();
    if (why === "") continue;
    prose.set(item.path, why);
  }

  return { prose, costUsd: result.costUsd };
}
