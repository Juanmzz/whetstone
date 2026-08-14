/**
 * What `init` produces. Deliberately just DATA: the core decides what a repo
 * should contain, the composition root decides how bytes reach the disk.
 *
 * This split is what makes `init` testable without a temp directory, and it is
 * also what keeps `src/core/init/` inside the FCIS boundary — nothing here can
 * write a file even by accident.
 */

export interface GeneratedFile {
  /** Repo-relative path in the TARGET repo. Always forward slashes. */
  readonly path: string;
  readonly contents: string;
  /** Hooks need the executable bit; everything else is a plain file. */
  readonly executable?: boolean;
}

/**
 * A payload file copied VERBATIM from Whetstone's own install (the skills). The
 * core names it; only the shell knows where Whetstone lives on this machine.
 * Copying beats generating here on purpose: a skill rewritten per project stops
 * being the same rule, and then improvements cannot travel back (ADR-0006).
 */
export interface CopyRequest {
  /** Path relative to Whetstone's payload root, e.g. `skills/voice.md`. */
  readonly from: string;
  /** Repo-relative destination in the target repo. */
  readonly to: string;
  /**
   * The file's text, read by the shell before planning.
   *
   * Optional because the payload directory is resolvable only at write time and
   * may not be there at all — a published package without its skills. Absent is
   * NOT the same as clean: `auditSelfContained` reports an unread copy rather
   * than passing it (hard rule 3).
   */
  readonly contents?: string;
}

/** YAML-safe scalar. JSON's quoting rules are a strict subset of YAML's. */
export function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** YAML flow sequence: `["a", "b"]`. Valid YAML, and one line in a diff. */
export function yamlList(values: readonly string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

/**
 * A literal block scalar (`|-`). Newlines survive EXACTLY, which a folded scalar
 * cannot promise — and a review lens whose paragraph breaks silently collapse is
 * a different prompt from the one that was calibrated.
 */
export function yamlBlock(value: string, indent = "  "): string {
  const lines = value.replace(/\s+$/, "").split("\n");
  return `|-\n${lines.map((l) => (l.length === 0 ? "" : `${indent}${l}`)).join("\n")}`;
}
