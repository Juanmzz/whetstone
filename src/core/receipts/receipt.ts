/**
 * The receipt record and the skip decision. PURE — the shell adapter reads and
 * writes the JSON, this decides what a receipt means.
 *
 * A receipt is a POSITIVE CLAIM: "check X passed on exactly this input". It is never
 * a record of failure. That is not a convention to remember — `outcome` is the
 * literal type `"pass"` and `recordPass` is the only constructor, so writing a
 * receipt for a failed check does not typecheck. A failed check simply leaves no
 * receipt behind, and the gate re-runs it next time.
 */

import { z } from "zod";
import { inputHash, type Digest, type HashedFile } from "./hash.js";

/**
 * On-disk record format. Bump it when the record's shape or meaning changes:
 * existing receipts then stop parsing and are re-earned, rather than being
 * misread under the new interpretation.
 */
export const RECEIPT_FORMAT = 1;

/** Same rule as `CheckSchema.id` — it is the same identifier, and it reaches a path. */
const CHECK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface Receipt {
  readonly format: typeof RECEIPT_FORMAT;
  /** The check that passed. Matches the `.sdd/checks/` filename stem. */
  readonly checkId: string;
  /** Recorded for the human reading the file; the binding lives inside `inputHash`. */
  readonly checkVersion: number;
  readonly inputHash: string;
  /** Audit aid: how many files the check matched when it earned this. */
  readonly matchedFiles: number;
  readonly outcome: "pass";
  /** ISO-8601, from `ClockPort`. */
  readonly recordedAt: string;
}

export interface PassInput {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly files: readonly HashedFile[];
  readonly at: Date;
  readonly digest?: Digest;
}

/**
 * The one and only way to mint a receipt.
 *
 * It computes the hash itself rather than accepting one. If the caller supplied both
 * a version and a pre-computed hash, nothing would stop them drifting apart, and a
 * receipt whose hash was earned under v1 while claiming v2 is precisely the bug the
 * version binding exists to prevent. One constructor, one binding, no drift.
 */
export function recordPass(input: PassInput): Receipt {
  if (!CHECK_ID.test(input.checkId)) {
    throw new Error(`invalid check id "${input.checkId}" — must be kebab-case`);
  }
  return {
    format: RECEIPT_FORMAT,
    checkId: input.checkId,
    checkVersion: input.checkVersion,
    inputHash: inputHash(input.files, input.checkVersion, input.digest),
    matchedFiles: input.files.length,
    outcome: "pass",
    recordedAt: input.at.toISOString(),
  };
}

/**
 * Why the gate re-ran a check, so the reason can be reported rather than guessed.
 * `input-changed` covers a check-version bump too: the version is inside the hash,
 * which is the whole mechanism.
 */
export type SkipReason = "no-receipt" | "input-changed" | "unusable-hash";

export type SkipDecision =
  | { readonly skip: true; readonly receipt: Receipt }
  | { readonly skip: false; readonly reason: SkipReason };

/**
 * Skip a check only when a receipt proves it already passed on this exact input.
 *
 * Every ambiguity resolves toward RE-RUNNING. A wrongly skipped check is an unnoticed
 * hole in the gate; a wrongly re-run check costs seconds.
 */
export function shouldSkip(receipt: Receipt | null | undefined, currentHash: string): SkipDecision {
  if (receipt === null || receipt === undefined) return { skip: false, reason: "no-receipt" };

  // A blank hash on either side means someone failed to compute one. Comparing two
  // blanks would be equal, and would skip everything.
  if (currentHash.trim() === "" || receipt.inputHash.trim() === "") {
    return { skip: false, reason: "unusable-hash" };
  }

  return receipt.inputHash === currentHash
    ? { skip: true, receipt }
    : { skip: false, reason: "input-changed" };
}

const ReceiptSchema = z.strictObject({
  format: z.literal(RECEIPT_FORMAT),
  checkId: z.string().regex(CHECK_ID),
  checkVersion: z.number().int().min(1),
  inputHash: z.string().min(1),
  matchedFiles: z.number().int().min(0),
  // The file on disk is editable by anyone. A hand-written `outcome: fail` that
  // parsed would let the gate skip a check that failed.
  outcome: z.literal("pass"),
  recordedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "not a parseable timestamp"),
});

export type ParsedReceipt =
  | { readonly ok: true; readonly receipt: Receipt }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate a receipt read back from disk. Returns a result rather than throwing:
 * receipts are a cache, so a corrupt one must degrade to a cache MISS, not crash the
 * gate. The caller can surface `reason` if it wants to explain the miss.
 */
export function parseReceipt(raw: unknown): ParsedReceipt {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `expected a receipt object, got ${raw === null ? "null" : typeof raw}` };
  }

  const parsed = ReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason };
  }

  return { ok: true, receipt: parsed.data };
}

/**
 * The receipt's filename. Lives here, not in the adapter: the check id reaches a
 * path join, so an unvalidated one is a directory traversal, and `src/shell/` is
 * meant to be thin enough that it cannot be the guard.
 */
export function receiptFileName(checkId: string): string {
  if (!CHECK_ID.test(checkId)) {
    throw new Error(
      `refusing to build a receipt path from "${checkId}" — a check id must be kebab-case`,
    );
  }
  return `${checkId}.json`;
}
