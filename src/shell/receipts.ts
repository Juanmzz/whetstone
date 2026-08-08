/**
 * Receipt store. THIN by policy: it moves JSON between `.sdd/receipts/` and the
 * pure core, and holds no rules of its own. Validation, the skip decision, the
 * filename and the input hash all live in `src/core/receipts/`.
 *
 * One file per check id, so a receipt is greppable and its change is a readable git
 * diff — Whetstone is files-first and git-native, and a pile of hash-named blobs
 * would not be. The file records the LATEST pass, not a history.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseReceipt, receiptFileName, type Receipt } from "../core/receipts/receipt.js";

export const RECEIPTS_DIR = "receipts";

/** `<sddRoot>/receipts/<check-id>.json`. Throws on a check id that is not kebab-case. */
export function receiptPath(sddRoot: string, checkId: string): string {
  return join(sddRoot, RECEIPTS_DIR, receiptFileName(checkId));
}

/**
 * The receipt for a check, or `null` when there is none.
 *
 * Missing, unreadable, malformed and tampered-with all collapse to `null` on
 * purpose: receipts are a cache, so every failure has to degrade to a cache MISS.
 * A miss costs one re-run; the other direction — trusting a receipt we could not
 * validate — is a silent hole in the gate.
 */
export async function readReceipt(sddRoot: string, checkId: string): Promise<Receipt | null> {
  let text: string;
  try {
    text = await readFile(receiptPath(sddRoot, checkId), "utf-8");
  } catch {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = parseReceipt(raw);
  return parsed.ok ? parsed.receipt : null;
}

/**
 * Persist a receipt. Only reachable with a `Receipt`, and `recordPass` is the only
 * way to make one — so "write on pass only" is enforced by the type, not by this
 * adapter remembering to check.
 */
export async function writeReceipt(sddRoot: string, receipt: Receipt): Promise<string> {
  const path = receiptPath(sddRoot, receipt.checkId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  return path;
}
