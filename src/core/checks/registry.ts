/**
 * Loading and indexing the check registry. PURE — the shell adapter reads files
 * from disk, this turns their text into a validated registry.
 *
 * One file per check (diffable, its own changelog and receipt), compiled into an
 * index for consumers that only need to know what runs.
 */

import { parse as parseYaml } from "yaml";
import { blockAuthority, type CalibrationReceipt } from "../calibration/receipt.js";
import { DEFINITION_DIR } from "../paths.js";
import { CheckSchema, type Check } from "./schema.js";

/**
 * What the loader knows about a lens's measurement. Supplied by the shell, which is
 * the only layer that can read `<id>.calibration.json` off disk and hash the fixture
 * directory as it exists right now.
 *
 * ABSENT MEANS DENIED. A caller that forgets to pass this must not thereby hand a
 * lens blocking authority — the failure mode of the field this replaced was exactly
 * "authority granted because nobody checked".
 */
export interface CalibrationEvidence {
  readonly receipt: CalibrationReceipt | null;
  /** sha256 of the fixture set as it exists now, or null when it cannot be read. */
  readonly currentFixturesHash: string | null;
}

export interface LoadedCheck extends Check {
  /** Prose after the frontmatter: rationale, and what to do when it fails. */
  readonly body: string;
}

export interface CheckIndexEntry {
  readonly id: string;
  readonly kind: Check["kind"];
  readonly severity: Check["severity"];
  readonly tiers: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly version: number;
  readonly enabled: boolean;
}

export interface CheckIndex {
  readonly version: 1;
  readonly checks: readonly CheckIndexEntry[];
  /** Ids of enabled checks that may block — what the gate reports up front. */
  readonly blocking: readonly string[];
}

export interface Registry {
  readonly all: readonly LoadedCheck[];
  readonly active: readonly LoadedCheck[];
  readonly byId: ReadonlyMap<string, LoadedCheck>;
  readonly index: CheckIndex;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseCheckFile(
  filename: string,
  contents: string,
  evidence?: CalibrationEvidence,
): LoadedCheck {
  const match = FRONTMATTER.exec(contents);
  if (match === null) {
    throw new Error(`${filename}: missing YAML frontmatter (expected a leading --- block)`);
  }

  const [, yamlText = "", body = ""] = match;

  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${filename}: frontmatter is not valid YAML: ${detail}`);
  }

  const parsed = CheckSchema.safeParse(raw);
  if (!parsed.success) {
    // Readable over machine-shaped: this is the error a human hits when their
    // check file is wrong, and a raw zod dump makes them work to find the field.
    const issues = parsed.error.issues
      .map((i) => `    ${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${filename}: invalid check definition\n${issues}`);
  }

  // A check's id is referenced by receipts and by other checks' `origin`. If a
  // rename could change the id silently, those references would rot invisibly.
  const stem = filename.replace(/\.md$/, "");
  if (parsed.data.id !== stem) {
    throw new Error(
      `${filename}: id "${parsed.data.id}" does not match the filename stem "${stem}"`,
    );
  }

  // NON-NEGOTIABLE 2, and the only place it is decided. An `llm` may hold
  // `block` only when a receipt describes THIS prompt against THESE fixtures and
  // passed. `blockAuthority` denies on every ambiguity, including the absent
  // evidence a forgetful caller produces.
  if (parsed.data.kind === "llm" && parsed.data.severity === "block") {
    const decision = blockAuthority(
      parsed.data.review_lens ?? "",
      evidence?.receipt ?? null,
      evidence?.currentFixturesHash ?? "",
    );
    if (!decision.ok) {
      throw new Error(
        `${filename}: llm "${parsed.data.id}" declares severity: block but has not ` +
          `earned it: ${decision.reason}`,
      );
    }
  }

  return { ...parsed.data, body: body.trim() };
}

export function buildRegistry(checks: readonly LoadedCheck[]): Registry {
  const byId = new Map<string, LoadedCheck>();
  for (const check of checks) {
    if (byId.has(check.id)) {
      throw new Error(
        `duplicate check id "${check.id}": ids must be unique across ${DEFINITION_DIR}/checks/`,
      );
    }
    byId.set(check.id, check);
  }

  const all = [...checks].sort((a, b) => a.id.localeCompare(b.id));
  const active = all.filter((c) => c.enabled);

  const index: CheckIndex = {
    version: 1,
    checks: all.map((c) => ({
      id: c.id,
      kind: c.kind,
      severity: c.severity,
      tiers: c.tiers,
      include: c.include,
      exclude: c.exclude,
      version: c.version,
      enabled: c.enabled,
    })),
    blocking: active.filter((c) => c.severity === "block").map((c) => c.id),
  };

  return { all, active, byId, index };
}
