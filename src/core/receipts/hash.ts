/**
 * The receipt input hash — Turborepo-style content addressing for the gate.
 */

import { createHash } from "node:crypto";

/** A changed file and its content hash, as produced by `GitPort.hashFile`. */
export interface HashedFile {
  readonly path: string;
  readonly hash: string;
}

/** A content digest over the canonical serialization. Injectable for tests. */
export type Digest = (input: string) => string;

/**
 * Serialization format tag. Bump it when the canonical form changes: every receipt
 * on disk then stops matching and is re-earned. Without the tag, a change to the
 * serialization would silently reuse receipts computed under the old one — the same
 * failure mode as dropping the check version, one level down.
 *
 * 2: the check's behaviour-determining fields joined the hash (sig-0028).
 */
export const RECEIPT_INPUT_FORMAT = 2;

/**
 * Everything about a CHECK that can change its outcome on unchanged code.
 *
 * `version` is the author's declaration that behaviour changed. The other fields are
 * the behaviour itself, hashed directly because the declaration is hand-maintained
 * and hand-maintained things drift — see the `check-behaviour binding` tests.
 *
 * Deliberately NOT here:
 *  - `severity`: a pass is a pass. Severity decides what a FAILURE does, and a
 *    receipt is only ever minted on pass.
 *  - `include` / `exclude`: they choose which files match, and the matched files are
 *    already hashed. Globs that select the same set produce the same outcome.
 *  - the check file's prose: it changes constantly and changes nothing.
 */
export interface CheckIdentity {
  readonly version: number;
  /** The shell command, for a `deterministic` check. Absent for a lens. */
  readonly command?: string;
  /** The review prompt, for an `llm`. Absent for a deterministic check. */
  readonly reviewLens?: string;
}

/**
 * NUL separates a path from its content hash. It is the one byte no filesystem
 * allows in a path, so no path can forge a field boundary. Using `:` or a space
 * would let `{path: "a b", hash: "c"}` and `{path: "a", hash: "b c"}` collide.
 */
const FIELD = "\0";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Length-prefixed, so no value can forge a field boundary and no two distinct
 * inputs can serialize alike. `-` is ABSENT and is distinct from `0:`, the empty
 * string: a check that declares no command is not a check whose command is "".
 */
function field(tag: string, value: string | undefined): string {
  return value === undefined ? `${tag}:-` : `${tag}:${String(value.length)}${FIELD}${value}`;
}

/**
 * The exact bytes that get hashed. Exported because the guarantees live here, and a
 * test that asserts on two opaque digests proves much less than one that can read
 * the input.
 */
export function canonicalInput(files: readonly HashedFile[], check: CheckIdentity): string {
  if (!Number.isInteger(check.version) || check.version < 1) {
    throw new Error(
      `check version must be a positive integer, got ${String(check.version)}: ` +
        `a receipt bound to a nonsense version is worse than no receipt`,
    );
  }

  // Sorted: the gate collects matched files from a glob walk, and iteration order
  // is not a guarantee it can make. If order moved the hash, every run would miss.
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const seen = new Set<string>();
  const entries = sorted.map((file) => {
    if (seen.has(file.path)) {
      throw new Error(
        `duplicate path in receipt input: "${file.path}": two content hashes for one ` +
          `file means the caller is confused, and hashing it anyway would mint a ` +
          `receipt that looks authoritative and is not`,
      );
    }
    seen.add(file.path);
    return `${file.path}${FIELD}${file.hash}`;
  });

  return [
    `wst-receipt/${RECEIPT_INPUT_FORMAT}`,
    // THE LOAD-BEARING LINES. See the doc comment on `inputHash`.
    `v:${check.version}`,
    field("c", check.command),
    field("l", check.reviewLens),
    `n:${entries.length}`,
    ...entries,
  ].join("\n").concat("\n");
}

/**
 * A stable content hash of everything a check's outcome depends on.
 *
 * **The check's identity is part of the hash, and must stay that way.** A receipt is
 * a claim that check X already passed on this input. Without the binding, editing a
 * check's behaviour would leave every old receipt still matching, and the gate would
 * report "already passed" for a check that has never once run in its current form. A
 * gate that is silently wrong is worse than no gate, because it is trusted.
 * `hash.test.ts` fails if either half of the binding is removed.
 *
 * ## WHAT THIS STILL CANNOT SEE — stated, not hidden
 *
 * The hash covers the changed files and the check's own definition. It does NOT
 * cover anything the command reaches at runtime: `.eslintrc`, `tsconfig.json`, a
 * pinned tool version in the lockfile, a fixture directory, an environment variable.
 * Upgrade vitest a major and every receipt still matches.
 *
 * That is a real hole and the honest mitigation today is `version`, bumped by hand.
 * The complete fix is Trunk Check's `affects_cache`: an explicit list of extra paths
 * a check depends on, hashed in alongside the changed files. It is not here because
 * it is a schema change, and a schema change is a conversation. Until then, do not
 * describe receipts as safe against config drift — they are not.
 */
export function inputHash(
  files: readonly HashedFile[],
  check: CheckIdentity,
  digest: Digest = sha256Hex,
): string {
  return digest(canonicalInput(files, check));
}
