/**
 * Check selection — step one of the gate. PURE.
 */

import { matchesGlob } from "node:path";
import type { LoadedCheck, Registry } from "../checks/registry.js";
import type { Check } from "../checks/schema.js";
import type { Routing } from "../contracts.js";
import type { ChangedFile } from "../diff/parse.js";

/** A check that will run, bound to the files it matched. */
export interface SelectedCheck {
  readonly check: LoadedCheck;
  readonly files: readonly ChangedFile[];
}

/**
 * Why a named check will not run. Deliberately the same two literals as
 * `CheckOutcome`'s non-receipt skip reasons: these become `skipped` results, and a
 * third reason invented here could not be reported through the shared contract.
 */
export type ExclusionReason = "not-in-tier" | "disabled";

export interface ExcludedCheck {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly severity: Check["severity"];
  readonly reason: ExclusionReason;
}

export interface Selection {
  /** Runnable, in routing order, de-duplicated. */
  readonly selected: readonly SelectedCheck[];
  /** Named by routing but not runnable. Reported as `skipped` in the verdict. */
  readonly excluded: readonly ExcludedCheck[];
  /**
   * Routing named a check the registry does not have. This is the GATE being
   * broken — a stale routing table or a deleted check file — not a fact about the
   * change, so it surfaces as `errored`, never as a failure.
   */
  readonly missingFromRegistry: readonly string[];
  /**
   * Enabled and in tier, but matched none of the changed files. It never applied,
   * so it is neither run nor skipped. Reported because node's `matchesGlob` returns
   * `false` for a malformed pattern rather than throwing: a typo in `include` looks
   * exactly like this, and an unreported one would be a check that quietly stopped
   * running.
   */
  readonly unmatched: readonly string[];
  /**
   * Checks that WOULD have covered these paths, and are switched off.
   *
   * Read from the registry, not from `routing.checks` — `route()` drops disabled
   * checks before selection ever sees them, which is why nothing could tell "no
   * check covers this change" apart from "the check that covers it is off". The
   * first has no remedy and exits 0 (adr-0021); the second has an obvious one and
   * must not.
   *
   * The glob match is the point: a retired check for another corner of the repo is
   * not declined coverage for a change it would never have looked at.
   */
  readonly declined: readonly string[];
}

function assertUsableGlob(pattern: string, checkId: string, field: "include" | "exclude"): void {
  if (pattern.trim() === "") {
    throw new Error(
      `check "${checkId}" declares an empty glob in \`${field}\`: an empty pattern matches ` +
        `nothing, which would silently disable the check rather than fail loudly`,
    );
  }
}

/**
 * The files a check applies to: matched by any `include`, then minus any `exclude`.
 *
 * Input order is preserved. `inputHash` sorts before hashing, so order does not
 * change a receipt — but keeping it stable keeps the printed report stable too.
 */
export function matchFiles(
  check: Pick<LoadedCheck, "id" | "include" | "exclude">,
  files: readonly ChangedFile[],
): readonly ChangedFile[] {
  for (const glob of check.include) assertUsableGlob(glob, check.id, "include");
  for (const glob of check.exclude) assertUsableGlob(glob, check.id, "exclude");

  return files.filter(
    (file) =>
      check.include.some((glob) => matchesGlob(file.path, glob)) &&
      !check.exclude.some((glob) => matchesGlob(file.path, glob)),
  );
}

export function selectChecks(
  routing: Routing,
  registry: Registry,
  files: readonly ChangedFile[],
): Selection {
  const selected: SelectedCheck[] = [];
  const excluded: ExcludedCheck[] = [];
  const missingFromRegistry: string[] = [];
  const unmatched: string[] = [];

  // One result per check id. A duplicate would produce two CheckResults for one
  // check, which `aggregate` rejects outright — better to never create it.
  const seen = new Set<string>();

  for (const id of routing.checks) {
    if (seen.has(id)) continue;
    seen.add(id);

    const check = registry.byId.get(id);
    if (check === undefined) {
      missingFromRegistry.push(id);
      continue;
    }

    // The check's own declaration outranks routing's claim. Routing can only ever
    // narrow what runs; it cannot authorise a check into a tier it disclaims.
    if (!check.enabled) {
      excluded.push({
        checkId: check.id,
        checkVersion: check.version,
        severity: check.severity,
        reason: "disabled",
      });
      continue;
    }
    if (!check.tiers.includes(routing.tier)) {
      excluded.push({
        checkId: check.id,
        checkVersion: check.version,
        severity: check.severity,
        reason: "not-in-tier",
      });
      continue;
    }

    const matched = matchFiles(check, files);
    if (matched.length === 0) {
      unmatched.push(check.id);
      continue;
    }

    selected.push({ check, files: matched });
  }

  const declined: string[] = [];
  for (const check of registry.byId.values()) {
    if (check.enabled) continue;
    if (!check.tiers.includes(routing.tier)) continue;
    if (matchFiles(check, files).length === 0) continue;
    declined.push(check.id);
  }

  return { selected, excluded, missingFromRegistry, unmatched, declined };
}

/** The checks that can answer while somebody is waiting. */
export function fastOnly(checks: readonly LoadedCheck[]): readonly LoadedCheck[] {
  return checks.filter((check) => !check.slow);
}
