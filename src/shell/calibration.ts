/**
 * Calibration receipts on disk. THIN: reads bytes, hands them to the pure core.
 *
 * Two jobs, and the second is the one that makes the mechanism work. Reading a
 * receipt is bookkeeping; hashing the fixture set AS IT IS RIGHT NOW is what lets
 * `blockAuthority` tell "measured" from "claims to have been measured".
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CalibrationReceiptSchema,
  fixturesHash,
  type CalibrationReceipt,
  type FixtureFile,
} from "../core/calibration/receipt.js";

/** Beside the check it authorises, so the pair moves together in a diff. */
export const receiptName = (checkId: string): string => `${checkId}.calibration.json`;

/**
 * The receipt, or null.
 *
 * A missing file is null — that is a lens nobody measured, which is normal. A file
 * that exists and does not parse is also null rather than a throw: it must DENY
 * authority, not take the registry down. Silent either way is fine here because the
 * denial message names the reason.
 */
export async function loadCalibration(
  sddRoot: string,
  checkId: string,
): Promise<CalibrationReceipt | null> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(sddRoot, "checks", receiptName(checkId)), "utf-8"),
    );
    const parsed = CalibrationReceiptSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Hash the fixture directory as it stands.
 *
 * The EXPECTED verdict comes from `manifest.json`, not from the diff — the diff is fed
 * to the lens verbatim, so a label written into it would leak the answer. Both halves
 * are hashed: the same files with the ground truth flipped is a different measurement.
 *
 * Returns null when the directory or its manifest cannot be read, which denies rather
 * than guesses.
 */
export async function hashFixtureDir(dir: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8"));
    const declared = (manifest as { fixtures?: { file: string; expect: string }[] }).fixtures;
    if (declared === undefined) return null;

    const onDisk = new Set((await readdir(dir)).filter((f) => f.endsWith(".diff")));

    const files: FixtureFile[] = [];
    for (const entry of declared) {
      // A manifest naming a file that is gone describes a set that does not exist.
      if (!onDisk.has(entry.file)) return null;
      const content = await readFile(join(dir, entry.file), "utf-8");
      files.push({
        path: entry.file,
        expected: entry.expect === "fail" ? "fail" : "pass",
        hash: createHash("sha256").update(content, "utf8").digest("hex"),
      });
    }

    // A .diff on disk that the manifest does not claim is an unlabelled fixture, and
    // the set is therefore not the one that was measured.
    if (files.length !== onDisk.size) return null;

    return fixturesHash(files);
  } catch {
    return null;
  }
}
