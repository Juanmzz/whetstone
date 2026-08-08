/**
 * The LLM verdict contract. PURE — given a raw `claude -p --output-format json`
 * envelope, decide whether we have a trustworthy verdict, should retry, or must
 * give up.
 *
 * This module exists because of a measured failure, not a hypothetical one. See
 * `.sdd/architecture.md`: with `--system-prompt` (replacing rather than appending),
 * the model emitted a payload that PASSED schema validation while carrying raw
 * tool-call markup inside a string field. Native `--json-schema` validation is
 * therefore necessary but not sufficient.
 */

import type { ZodType } from "zod";

export type JudgeErrorKind =
  /** The model could not produce a valid verdict within the allowed attempts. */
  | "invalid-output"
  /** Ran out of budget / turns / time — infrastructure, NOT a failed check. */
  | "budget"
  | "max-turns"
  | "timeout"
  /** Could not run `claude` at all, or it refused to authenticate. */
  | "spawn"
  | "auth"
  | "unknown";

export interface JudgeError {
  readonly kind: JudgeErrorKind;
  readonly detail: string;
}

export type VerdictOutcome<T> =
  | { readonly kind: "accept"; readonly value: T }
  | { readonly kind: "retry"; readonly reason: string }
  | { readonly kind: "fail"; readonly error: JudgeError };

export interface AttemptWindow {
  /** 1-based. */
  readonly attempt: number;
  readonly maxAttempts: number;
}

/**
 * Markers that must never appear inside a verdict field. Their presence means the
 * model emitted its tool-call scaffolding as content — the payload is unusable
 * however well-typed it looks.
 *
 * Kept deliberately NARROW. An earlier version also matched a bare `</`, which
 * would flag any lens legitimately quoting closing tags while reviewing HTML or
 * JSX ("the `</div>` is unclosed") — turning every front-end review into a retry
 * loop. Only tool-call scaffolding belongs here.
 */
const CONTAMINATION_MARKERS = [
  "</parameter>",
  "<parameter name=",
  "</invoke>",
  "<invoke name=",
  "<function_calls>",
  "</function_calls>",
] as const;

/** `is_error` subtypes we can attribute precisely. Anything else is `unknown`. */
function classifyHardError(subtype: unknown, detail: string): JudgeError {
  const s = typeof subtype === "string" ? subtype : "";
  if (s.includes("budget")) return { kind: "budget", detail };
  if (s.includes("max_turns")) return { kind: "max-turns", detail };
  if (s.includes("timeout")) return { kind: "timeout", detail };
  if (s.includes("auth") || s.includes("credential")) return { kind: "auth", detail };
  return { kind: "unknown", detail };
}

function findContamination(value: unknown): string | null {
  if (typeof value === "string") {
    for (const marker of CONTAMINATION_MARKERS) {
      if (value.includes(marker)) return marker;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findContamination(item);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      const hit = findContamination(item);
      if (hit !== null) return hit;
    }
  }
  return null;
}

export function interpretEnvelope<S extends ZodType>(
  raw: unknown,
  schema: S,
  window: AttemptWindow,
): VerdictOutcome<ReturnType<S["parse"]>> {
  type Value = ReturnType<S["parse"]>;

  const retryOrGiveUp = (reason: string): VerdictOutcome<Value> =>
    window.attempt < window.maxAttempts
      ? { kind: "retry", reason }
      : { kind: "fail", error: { kind: "invalid-output", detail: reason } };

  if (raw === null || typeof raw !== "object") {
    return {
      kind: "fail",
      error: { kind: "unknown", detail: `envelope was ${typeof raw}, expected an object` },
    };
  }

  const env = raw as Record<string, unknown>;

  // Hard errors are never retried here — the caller decides whether a fresh
  // invocation makes sense. Retrying a budget stop just burns more budget.
  if (env["is_error"] === true) {
    return {
      kind: "fail",
      error: classifyHardError(env["subtype"], String(env["subtype"] ?? "unknown error")),
    };
  }

  const structured = env["structured_output"];
  if (structured === undefined || structured === null) {
    return retryOrGiveUp("envelope carried no structured_output");
  }

  const contaminant = findContamination(structured);
  if (contaminant !== null) {
    return retryOrGiveUp(
      `structured_output is contaminated with tool-call markup (${contaminant})`,
    );
  }

  const parsed = schema.safeParse(structured);
  if (!parsed.success) {
    return retryOrGiveUp(`structured_output failed schema validation: ${parsed.error.message}`);
  }

  return { kind: "accept", value: parsed.data as Value };
}
