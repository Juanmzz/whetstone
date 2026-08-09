/**
 * The annotation — Layer 5, "where a human should actually look". PURE.
 *
 * Everything the reviewer sees is decided here and nowhere else. The composition:
 *
 *   TriageResult (per-file tier)  ─┐
 *   GateVerdict  (per-check)      ─┼─> attributeFindings ─> criticalityFor ─> Annotation
 *   Selection    (check coverage) ─┘
 *
 * ## Three states, three different words — the same discipline as `gate/report.ts`
 *
 * A reviewer must never be able to read "verified" out of something that was not,
 * and must never be sent to a file on a guess. So the file rows carry three separate
 * facts and only ONE of them can raise criticality:
 *
 *   `findings`     a check ran and said no, about THIS file      → raises criticality
 *   `notVerified`  a check that covered this file could not run  → never raises it
 *   `viaReceipt`   a check passed earlier on identical input     → never raises it
 *
 * Collapsing `notVerified` into `findings` is the tempting bug: a flaky lens would
 * paint the whole change red, which is both a lie and — because it happens on every
 * timeout — the fastest way to teach a reviewer to ignore the colours.
 *
 * ## `blocking` is a REVIEW POSTURE, not the gate
 *
 * `event` is `REQUEST_CHANGES` only for a strict-tier change with a block-severity
 * finding. `wst gate`'s exit code is the enforcement channel and is unaffected: a
 * block-severity failure on a `light` change still exits 1 and still fails CI. What
 * this decides is whether a human is formally asked to reject the PR, and the tier
 * is exactly the project's own statement about when that is warranted.
 */

import type { Tier } from "../checks/schema.js";
import type { GateVerdict, TriageResult } from "../contracts.js";
import { criticalityFor, type Criticality } from "./criticality.js";
import { attributeFindings, type CheckCoverage, type Finding } from "./findings.js";

export interface AnnotateInput {
  /** Per-file tiers. `matches` is the authoritative list of files in the change. */
  readonly triage: TriageResult;
  readonly verdict: GateVerdict;
  /** `Selection.selected[]` flattened — what each check actually ran over. */
  readonly coverage: readonly CheckCoverage[];
}

export interface FileAnnotation {
  readonly path: string;
  readonly tier: Tier;
  readonly criticality: Criticality;
  /** Findings localised to this file. The only input that can raise criticality. */
  readonly findings: readonly Finding[];
  /** Checks that covered this file and ERRORED. Reported, never red. */
  readonly notVerified: readonly string[];
  /** Checks skipped because a receipt already vouched for this exact input. */
  readonly viaReceipt: readonly string[];
  /** ENGINE-written, always present. The LLM's prose is separate and optional. */
  readonly reason: string;
}

export type ReviewEvent = "REQUEST_CHANGES" | "COMMENT";

export interface Annotation {
  readonly tier: Tier;
  /** review first, then skim, then skip; alphabetical within a level. */
  readonly files: readonly FileAnnotation[];
  /** Real failures that name no file in the change. */
  readonly unattributed: readonly Finding[];
  /** Check ids that could not run at all. NOT failures — see `gate/aggregate.ts`. */
  readonly notVerified: readonly string[];
  readonly counts: Readonly<Record<Criticality, number>>;
  readonly blocking: boolean;
  readonly event: ReviewEvent;
  /** No check produced a single finding, localised or otherwise. */
  readonly clean: boolean;
}

const ORDER: Readonly<Record<Criticality, number>> = { review: 0, skim: 1, skip: 2 };

const list = (ids: readonly string[]): string => ids.join(", ");

/**
 * The engine's sentence. Deterministic, cheap, and sufficient on its own — the LLM
 * prose in `prose.ts` is an ADDITION to this, never a replacement, so a judge that
 * times out costs the reviewer nuance and never the annotation itself.
 */
function reasonFor(file: {
  tier: Tier;
  criticality: Criticality;
  findings: readonly Finding[];
  notVerified: readonly string[];
  viaReceipt: readonly string[];
}): string {
  const parts: string[] = [];

  const blocking = file.findings.filter((f) => f.severity === "block");
  const advisory = file.findings.filter((f) => f.severity !== "block");

  if (blocking.length > 0) {
    parts.push(`${list(blocking.map((f) => f.checkId))} reported a problem here`);
  }
  if (advisory.length > 0) {
    parts.push(`${list(advisory.map((f) => f.checkId))} raised an advisory here`);
  }
  // Loud, and deliberately in capitals: this is the sentence that stops a reader
  // concluding "green" from the absence of a finding.
  if (file.notVerified.length > 0) {
    parts.push(`NOT VERIFIED: ${list(file.notVerified)} could not run`);
  }
  if (file.viaReceipt.length > 0) {
    parts.push(`${list(file.viaReceipt)} not re-run — receipt from an identical input`);
  }

  // THE FALLBACK, and only ever a fallback — it goes LAST for that reason. Prefixing
  // the generic sentence to a row that already says something buries the part the
  // reader needs; eleven rows all opening with "strict tier, no finding" is
  // wallpaper. Found by running `wst pr --dry-run` on this lane's own commit.
  if (parts.length === 0) {
    parts.push(
      file.tier === "strict"
        ? "strict tier, no finding — glance to confirm the intent, not to hunt for bugs"
        : "no finding",
    );
  }

  return parts.join(" · ");
}

export function annotate(input: AnnotateInput): Annotation {
  const { triage, verdict, coverage } = input;

  const tierOf = new Map<string, Tier>(triage.matches.map((m) => [m.file.path, m.tier]));
  const { attributed, unattributed } = attributeFindings(verdict, coverage);

  // A finding pointing outside the diff cannot be drawn on a file row. Rather than
  // inventing a row for a path nobody changed, it degrades to the honest state we
  // already have a slot for.
  const orphaned: Finding[] = [];
  const byPath = new Map<string, Finding[]>();
  for (const finding of attributed) {
    if (finding.path === null) continue;
    if (!tierOf.has(finding.path)) {
      orphaned.push(finding);
      continue;
    }
    const bucket = byPath.get(finding.path);
    if (bucket === undefined) byPath.set(finding.path, [finding]);
    else bucket.push(finding);
  }

  // Which checks covered which file, for the two non-raising columns.
  const coveredBy = new Map<string, string[]>();
  for (const entry of coverage) {
    for (const path of entry.paths) {
      const bucket = coveredBy.get(path);
      if (bucket === undefined) coveredBy.set(path, [entry.checkId]);
      else bucket.push(entry.checkId);
    }
  }

  const erroredIds = new Set(
    verdict.results.filter((r) => r.outcome.status === "errored").map((r) => r.checkId),
  );
  const receiptIds = new Set(
    verdict.results
      .filter((r) => r.outcome.status === "skipped" && r.outcome.reason === "receipt")
      .map((r) => r.checkId),
  );

  const files: FileAnnotation[] = triage.matches.map((match) => {
    const path = match.file.path;
    const findings = byPath.get(path) ?? [];
    const covered = coveredBy.get(path) ?? [];

    const notVerified = covered.filter((id) => erroredIds.has(id));
    const viaReceipt = covered.filter((id) => receiptIds.has(id));

    // THE RULE. `notVerified` and `viaReceipt` are deliberately NOT arguments.
    const criticality = criticalityFor(match.tier, findings);

    return {
      path,
      tier: match.tier,
      criticality,
      findings,
      notVerified,
      viaReceipt,
      reason: reasonFor({ tier: match.tier, criticality, findings, notVerified, viaReceipt }),
    };
  });

  // Stable by construction: rank, then path. Two runs over one change must render
  // byte-identically or the PR body churns on every push.
  files.sort((a, b) =>
    ORDER[a.criticality] !== ORDER[b.criticality]
      ? ORDER[a.criticality] - ORDER[b.criticality]
      : a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0,
  );

  const counts: Record<Criticality, number> = { review: 0, skim: 0, skip: 0 };
  for (const file of files) counts[file.criticality] += 1;

  const allUnattributed = [...unattributed, ...orphaned];
  const everyFinding = [...attributed.filter((f) => !orphaned.includes(f)), ...allUnattributed];

  // Strict tier plus a correctness-class finding. `errored` is not consulted — it is
  // not a finding, and a broken judge must not be able to reject someone's work.
  const blocking =
    triage.tier === "strict" && everyFinding.some((finding) => finding.severity === "block");

  return {
    tier: triage.tier,
    files,
    unattributed: allUnattributed,
    notVerified: [...erroredIds],
    counts,
    blocking,
    event: blocking ? "REQUEST_CHANGES" : "COMMENT",
    clean: everyFinding.length === 0,
  };
}
