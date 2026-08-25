/**
 * What changed since `init` wrote this repo. PURE.
 *
 * adr-0006 asks for a 3-way merge against a recorded base. This is the half that has
 * to exist first: without knowing whether a file is as `init` left it, update has only
 * bad moves — overwrite a human's edit, or never update anything.
 */

import { z } from "zod";
import { AnswersSchema, type InterviewAnswers } from "./interview.js";

/** Inside the definition directory, beside the pages it describes. Committed. */
export const BASE_FILE = "base.json";

export interface RecordedBase {
  /** The Whetstone that wrote it. A base from a version this one cannot read is a base to redo. */
  readonly version: string;
  readonly generatedAt: string;
  readonly answers: InterviewAnswers;
  /** Repo-relative path to the sha256 of what `init` wrote there. */
  readonly files: Readonly<Record<string, string>>;
}

export type Disposition =
  | "identical"
  | "drifted"
  | "outdated"
  | "missing"
  | "new"
  | "orphan";

export interface FileVerdict {
  readonly path: string;
  readonly disposition: Disposition;
}

export interface UpdateInput {
  readonly base: RecordedBase;
  /** sha256 of what is on disk now. Absent means the file is gone. */
  readonly onDisk: ReadonlyMap<string, string>;
  /** sha256 of what THIS version of `init` would write. Absent means it no longer writes it. */
  readonly expected: ReadonlyMap<string, string>;
}

function dispositionOf(
  recorded: string | undefined,
  disk: string | undefined,
  expected: string | undefined,
): Disposition {
  if (recorded === undefined) return "new";
  if (disk === undefined) return "missing";

  // DRIFTED wins over OUTDATED when both hold. Regenerating a hand-edited file is
  // silent data loss, and "outdated" is the word that invites exactly that.
  if (disk !== recorded) return "drifted";
  if (expected === undefined) return "orphan";
  return expected === recorded ? "identical" : "outdated";
}

export function classifyUpdate(input: UpdateInput): readonly FileVerdict[] {
  const paths = new Set<string>([
    ...Object.keys(input.base.files),
    ...input.onDisk.keys(),
    ...input.expected.keys(),
  ]);

  return [...paths]
    .sort()
    .map((path) => ({
      path,
      disposition: dispositionOf(
        input.base.files[path],
        input.onDisk.get(path),
        input.expected.get(path),
      ),
    }));
}

/** Git's object ids are not used here: this is content, not a blob with a header. */
const SHA256 = /^[0-9a-f]{64}$/;

const BaseSchema = z.strictObject({
  version: z.string().min(1),
  generatedAt: z.string().min(1),
  answers: AnswersSchema,
  // Validated, not merely typed. A truncated hash never equals a real one, so every
  // file it covers would read as `drifted` forever and never be updatable again.
  files: z.record(z.string(), z.string().regex(SHA256)),
});

export function parseBase(raw: unknown): RecordedBase {
  const parsed = BaseSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `base.json is not a recorded base: ${first?.path.join(".") ?? "?"}: ${first?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

export function renderBase(base: RecordedBase): string {
  return `${JSON.stringify(base, null, 2)}\n`;
}

/** What each disposition means to somebody deciding what to do about it. */
const MEANING: Readonly<Record<Disposition, string>> = {
  drifted: "edited here since init: regenerating would lose that",
  outdated: "untouched, and this version writes it differently",
  missing: "recorded, and no longer on disk",
  new: "this version writes it, and your base predates it",
  orphan: "nothing writes it any more",
  identical: "as init left it",
};

/** Loudest first: what costs a decision, then what is merely news. */
const ORDER: readonly Disposition[] = ["drifted", "outdated", "missing", "new", "orphan", "identical"];

export function renderUpdate(verdicts: readonly FileVerdict[]): string {
  const lines: string[] = [];
  for (const disposition of ORDER) {
    const group = verdicts.filter((v) => v.disposition === disposition);
    if (group.length === 0) continue;
    if (disposition === "identical") {
      lines.push(`  ${String(group.length)} file(s) are as init left them`);
      continue;
    }
    lines.push(`  ${disposition}: ${MEANING[disposition]}`);
    for (const v of group) lines.push(`    ${v.path}`);
  }
  if (lines.length === 0) lines.push("  nothing to compare: the base records no files");
  return lines.join("\n");
}
