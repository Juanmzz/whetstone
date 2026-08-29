/**
 * Requiring evidence of the RESULT, without judging it (adr-0036). PURE.
 *
 * Every other check reads the diff, so a green gate says nothing broke and never
 * says what was built. This one says the artifact exists. Whether the screen looks
 * right is the human's call, and a lens that read it would be a judgment check
 * owing its own calibration (non-negotiable 2).
 */

import { basename, dirname, join } from "node:path";

/** The store's name, beside the repo. Never committed, so nothing travels. */
export const EVIDENCE_DIR = ".wst-evidence";

/** Extensions whose shape a check may assert while staying deterministic. */
const TEXT = new Set(["json", "txt", "log", "md", "http", "csv"]);

/**
 * Where one requirement's evidence lives, BESIDE the repo.
 *
 * `repoRoot` is the main checkout, so every linked worktree of a repo shares one
 * store and the branch is what separates them. Inside the repo it would either be
 * committed (adr-0004: the payload may not make a target repo worse) or show up as
 * dirt in the diff the gate is judging.
 */
export function evidenceDir(repoRoot: string, branch: string, checkId: string): string {
  const slug = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
  return join(dirname(repoRoot), EVIDENCE_DIR, basename(repoRoot), slug, checkId);
}

export function isMachineReadable(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && TEXT.has(name.slice(dot + 1).toLowerCase());
}

export interface FoundEvidence {
  readonly name: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  /** The text, for `isMachineReadable` names. `null` when only a human can read it. */
  readonly text: string | null;
}

export type EvidenceVerdict =
  | { readonly kind: "present"; readonly count: number }
  | { readonly kind: "absent" }
  | { readonly kind: "empty"; readonly name: string }
  | { readonly kind: "malformed"; readonly name: string; readonly why: string }
  | { readonly kind: "stale"; readonly name: string; readonly behindMs: number };

/** An artifact that carries nothing, or that claims a format it does not hold. */
function shapeOf(f: FoundEvidence): EvidenceVerdict | null {
  if (f.bytes === 0) return { kind: "empty", name: f.name };
  if (f.text === null) return null;
  if (f.text.trim() === "") return { kind: "empty", name: f.name };
  if (!f.name.toLowerCase().endsWith(".json")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(f.text);
  } catch (cause) {
    return { kind: "malformed", name: f.name, why: (cause as Error).message };
  }
  return isEmptyJson(parsed) ? { kind: "empty", name: f.name } : null;
}

function isEmptyJson(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * `newestSourceMs` is the newest mtime among the changed files this check matched.
 * Freshness is per DIRECTORY, not per file: a run that adds a second screenshot
 * beside last week's has still shown the current code.
 */
export function judgeEvidence(
  found: readonly FoundEvidence[],
  newestSourceMs: number | null,
): EvidenceVerdict {
  if (found.length === 0) return { kind: "absent" };

  for (const f of found) {
    const broken = shapeOf(f);
    if (broken !== null) return broken;
  }

  if (newestSourceMs === null) return { kind: "present", count: found.length };

  const newest = found.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  return newest.mtimeMs < newestSourceMs
    ? { kind: "stale", name: newest.name, behindMs: newestSourceMs - newest.mtimeMs }
    : { kind: "present", count: found.length };
}
