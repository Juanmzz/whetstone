/**
 * Loading and indexing the check registry. PURE — the shell adapter reads files
 * from disk, this turns their text into a validated registry.
 *
 * One file per check (diffable, its own changelog and receipt), compiled into an
 * index for consumers that only need to know what runs.
 */

import { parse as parseYaml } from "yaml";
import { CheckSchema, type Check } from "./schema.js";

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

export function parseCheckFile(filename: string, contents: string): LoadedCheck {
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
    throw new Error(`${filename}: frontmatter is not valid YAML — ${detail}`);
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

  return { ...parsed.data, body: body.trim() };
}

export function buildRegistry(checks: readonly LoadedCheck[]): Registry {
  const byId = new Map<string, LoadedCheck>();
  for (const check of checks) {
    if (byId.has(check.id)) {
      throw new Error(`duplicate check id "${check.id}" — ids must be unique across .sdd/checks/`);
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
