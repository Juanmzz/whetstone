/**
 * Attribution — turning the gate's PER-CHECK verdict into PER-FILE findings. PURE.
 *
 * ## The seam this closes
 *
 * `GateVerdict` carries no file attribution at all. A `CheckResult` is
 * `{checkId, severity, outcome, durationMs}` — it records that `typecheck` failed,
 * not which of the eleven files it ran over is broken. That is correct for the gate,
 * whose only question is pass-or-block, and it is exactly the information the
 * annotation layer needs. This module is where the two are reconciled, and it is
 * reconciled by READING THE FAILURE TEXT, which is the only place the information
 * exists.
 *
 * ## Three rules, all of them about not lying
 *
 * 1. **A finding lands only on a file the failure NAMES.** The tempting alternative —
 *    spread the finding over every file the check covered — is `max()` in disguise:
 *    one failing typecheck would repaint all forty files red and the annotation would
 *    be worth nothing. `findings.test.ts` pins this at 40 files.
 * 2. **A named file must also be one the check COVERED.** Failure output quotes all
 *    sorts of paths — vendored code, fixtures, an expected-vs-actual dump. Coverage
 *    (from `Selection.selected[].files`) is the check's own account of what it looked
 *    at, so it is the authority on what it could have an opinion about.
 * 3. **When nothing survives, say so.** `"3 tests failed"` names no file. The finding
 *    is real and it still drives `blocking`, but we do not know where to look, and a
 *    guess with a red marker on it is worse than an honest "not localised". It goes
 *    to `unattributed`.
 *
 * ## What is NOT a finding
 *
 * Only `status: "fail"` produces one. `errored` is the gate being broken and carries
 * no judgement about the change (`core/gate/aggregate.ts`, rule 1) — its detail often
 * contains paths, so this module must ignore it explicitly rather than by accident.
 * `skipped` and `pass` are likewise silent.
 */

import type { Check } from "../checks/schema.js";
import type { GateVerdict } from "../contracts.js";

/**
 * One reason a human should look at one place.
 *
 * `path: null` means "the failure is real but names no file we can point at". It is
 * a distinct state, not a missing value, which is why it is `null` rather than an
 * optional property: a caller destructuring it has to decide what to do.
 */
export interface Finding {
  readonly checkId: string;
  readonly severity: Check["severity"];
  readonly detail: string;
  readonly path: string | null;
  /** 1-based, when the failure gave one. Absent is normal, not an error. */
  readonly line?: number;
}

/** What one check actually ran over — `Selection.selected[].files`, flattened. */
export interface CheckCoverage {
  readonly checkId: string;
  readonly paths: readonly string[];
}

export interface Attribution {
  /** Findings bound to a file. These are what colour the annotation. */
  readonly attributed: readonly Finding[];
  /** Real failures that name no covered file. Reported, never localised. */
  readonly unattributed: readonly Finding[];
}

/**
 * A path-shaped token, optionally followed by `:line` or `:line:col`.
 *
 * Deliberately loose on the path and strict on the shape: it only has to produce
 * CANDIDATES, because rule 2 then discards anything the check did not cover. Being
 * loose here costs nothing; being strict here would silently drop a tool whose
 * output format we did not anticipate, and a finding that fails to localise is the
 * one failure mode that looks like success.
 *
 * The extension is required — without it `at Object.<anonymous>` and every prose
 * sentence containing a full stop becomes a candidate path.
 */
const PATH_RE = /([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)(?::(\d+))?(?::\d+)?/g;

/**
 * Does a path printed by some tool refer to this covered file?
 *
 * Equal, or the printed path ends with `/<covered>` — which is how an absolute path
 * from a compiler resolves. The leading slash is REQUIRED: a bare `endsWith` would
 * match `src/mybar.ts` against covered `bar.ts`, attributing a finding to a file
 * that has nothing to do with it.
 */
function refersTo(printed: string, covered: string): boolean {
  const normalised = printed.startsWith("./") ? printed.slice(2) : printed;
  return normalised === covered || normalised.endsWith(`/${covered}`);
}

/** `path` + `line`, in first-mention order, de-duplicated. */
function mentions(detail: string, covered: readonly string[]): { path: string; line?: number }[] {
  const out: { path: string; line?: number }[] = [];
  const seen = new Set<string>();

  // `matchAll` on a /g regex restarts from zero each call, so this is re-entrant.
  for (const match of detail.matchAll(PATH_RE)) {
    const printed = match[1];
    if (printed === undefined) continue;

    const hit = covered.find((path) => refersTo(printed, path));
    if (hit === undefined) continue;

    const raw = match[2];
    const line = raw === undefined ? undefined : Number.parseInt(raw, 10);
    const key = `${hit}:${line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(line === undefined ? { path: hit } : { path: hit, line });
  }

  return out;
}

export function attributeFindings(
  verdict: GateVerdict,
  coverage: readonly CheckCoverage[],
): Attribution {
  const covered = new Map(coverage.map((c) => [c.checkId, c.paths]));
  const attributed: Finding[] = [];
  const unattributed: Finding[] = [];

  for (const result of verdict.results) {
    // The ONE gate through which a CheckResult becomes a finding. `errored` is
    // filtered here and nowhere else, so the rule is in one readable place.
    if (result.outcome.status !== "fail") continue;

    const detail = result.outcome.detail;
    const here = mentions(detail, covered.get(result.checkId) ?? []);

    if (here.length === 0) {
      unattributed.push({
        checkId: result.checkId,
        severity: result.severity,
        detail,
        path: null,
      });
      continue;
    }

    for (const at of here) {
      attributed.push({
        checkId: result.checkId,
        severity: result.severity,
        detail,
        path: at.path,
        ...(at.line !== undefined ? { line: at.line } : {}),
      });
    }
  }

  return { attributed, unattributed };
}
