/**
 * The LLM verdict contract. PURE — given a raw `claude -p --output-format json`
 * envelope, decide whether we have a trustworthy verdict, should retry, or must
 * give up.
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
  | {
      readonly kind: "accept";
      readonly value: T;
      /** Set when trailing tool-call markup was stripped — never silent. */
      readonly sanitized?: string;
    }
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

/**
 * The model closes its tool call INSIDE a string field, so the artifact appears as
 * a well-formed SUFFIX with complete prose in front of it. Measured: 0/40 runs on
 * diffs under 10 lines, 13/40 on 11-15 line diffs (sig-0008).
 *
 * Rejecting the whole verdict — the original rule — threw away correct answers and
 * burned three billed retries into the same deterministic failure. A gate blind on
 * a third of realistic diffs is worse than one that strips a known suffix. Markup
 * anywhere OTHER than the tail still fails closed: that means content and
 * scaffolding are interleaved, which is not recoverable.
 */
const TRAILING_MARKUP =
  /(?:\s*(?:<\/parameter>|<\/invoke>|<\/function_calls>|<parameter\s+name="[^"]*">|<invoke\s+name="[^"]*">))+\s*$/;

function stripTrailingMarkup(value: unknown): { value: unknown; stripped: string | null } {
  if (typeof value === "string") {
    const match = TRAILING_MARKUP.exec(value);
    if (match === null) return { value, stripped: null };
    return { value: value.slice(0, match.index).trimEnd(), stripped: match[0].trim() };
  }
  if (Array.isArray(value)) {
    let stripped: string | null = null;
    const out = value.map((item) => {
      const r = stripTrailingMarkup(item);
      stripped ??= r.stripped;
      return r.value;
    });
    return { value: out, stripped };
  }
  if (value !== null && typeof value === "object") {
    let stripped: string | null = null;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const r = stripTrailingMarkup(item);
      stripped ??= r.stripped;
      out[key] = r.value;
    }
    return { value: out, stripped };
  }
  return { value, stripped: null };
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

  if (env["is_error"] === true) {
    const subtype = String(env["subtype"] ?? "unknown error");
    // A fresh invocation is a fresh sampling, which a budget stop or an auth
    // failure is not.
    if (subtype.includes("structured_output")) {
      return retryOrGiveUp(`the judge could not produce a valid answer: ${subtype}`);
    }
    return { kind: "fail", error: classifyHardError(env["subtype"], subtype) };
  }

  const structured = env["structured_output"];
  if (structured === undefined || structured === null) {
    return retryOrGiveUp("envelope carried no structured_output");
  }

  // Strip the recoverable trailing artifact FIRST, then reject whatever markup is
  // left — which by definition is embedded in the content, not suffixed to it.
  const { value: cleaned, stripped } = stripTrailingMarkup(structured);

  const contaminant = findContamination(cleaned);
  if (contaminant !== null) {
    return retryOrGiveUp(
      `structured_output is contaminated with tool-call markup embedded mid-content (${contaminant})`,
    );
  }

  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    return retryOrGiveUp(`structured_output failed schema validation: ${parsed.error.message}`);
  }

  return {
    kind: "accept",
    value: parsed.data as Value,
    ...(stripped !== null ? { sanitized: stripped } : {}),
  };
}
