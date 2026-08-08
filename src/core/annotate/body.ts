/**
 * Rendering the annotation — the PR body and the inline review comments. PURE.
 *
 * Two products, one input:
 *
 *   `renderBody`      the map. 🔴 and 🟡 named individually, ⚪ collapsed to ONE line.
 *   `inlineComments`  the pins. 🔴 ONLY — a notification per skimmable file is how a
 *                     bot gets muted, and a muted bot annotates nothing.
 *
 * ## Why ⚪ is collapsed rather than dropped
 *
 * Dropping them would be dishonest: a reviewer cannot tell "we looked and it was
 * trivial" from "we never looked". Listing them buries the two files that matter
 * under thirty that do not. One line does both jobs — the count is there, the names
 * are one click away in the Files tab where they already live.
 *
 * ## Idempotency lives HERE, not in the adapter
 *
 * `wst pr` must be safe to run on every push. GitHub has no upsert for review
 * comments, so the identity has to be carried in the payload: every comment ends
 * with an invisible `<!-- wst:… -->` fingerprint over (check, file, line, detail).
 * `pruneAlreadyPosted` drops anything already bearing its fingerprint, and the PR
 * body is replaced between markers rather than appended to. Both are pure functions
 * over data the adapter merely fetches — so "running twice does not duplicate" is a
 * unit test, not something you find out in production on someone's real PR.
 */

import { createHash } from "node:crypto";
import type { Annotation, FileAnnotation } from "./annotate.js";
import { MARK } from "./criticality.js";
import type { Finding } from "./findings.js";

export const BODY_START = "<!-- whetstone:annotate:v1 -->";
export const BODY_END = "<!-- /whetstone:annotate:v1 -->";

/** Prefix of the invisible marker that makes a comment recognisably ours. */
const FP_PREFIX = "wst:";

export interface RenderOptions {
  /**
   * LLM-written "look here because X", keyed by path. ONLY consulted for 🔴 — see
   * `prose.ts`. A missing entry is normal: the engine reason always stands alone.
   */
  readonly prose?: ReadonlyMap<string, string>;
  /** The diff range the gate ran over, for the receipt line. */
  readonly range?: string;
}

// ── fingerprints ─────────────────────────────────────────────────────────────

export interface FingerprintInput {
  readonly checkId: string;
  readonly path: string;
  readonly detail: string;
  readonly line?: number;
}

/**
 * A stable id for one comment. NUL-separated for the same reason
 * `receipts/hash.ts` uses it: no field can forge a boundary into another.
 *
 * The DETAIL is part of it on purpose. If a check reports a different problem at the
 * same line, that is a new thing to say and deserves a new comment; if it reports
 * the same problem again, the reviewer has already read it.
 */
export function fingerprint(input: FingerprintInput): string {
  const canonical = [
    "wst-annotate/1",
    input.checkId,
    input.path,
    String(input.line ?? ""),
    input.detail,
  ].join("\0");
  return `${FP_PREFIX}${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16)}`;
}

// ── the body ─────────────────────────────────────────────────────────────────

function detailBlock(findings: readonly Finding[]): string[] {
  const lines: string[] = [];
  for (const finding of findings) {
    const first = finding.detail.split("\n")[0] ?? "";
    lines.push(`  - \`${finding.checkId}\`: ${first.trim()}`);
  }
  return lines;
}

/**
 * Does this row's reason say anything the heading has not already said?
 *
 * Found by running `wst pr --dry-run` on Whetstone itself: 54 skim rows, each
 * carrying the identical sentence "strict tier, no finding — glance to confirm the
 * intent". That is the criticality rule's own failure mode one level down — text
 * repeated on every row is wallpaper, and it pushes the rows that DO say something
 * (a not-verified check, a receipt reuse) off the top of a reviewer's attention.
 *
 * `FileAnnotation.reason` is unchanged and still goes out in `--json`: this is a
 * rendering decision, not a change to what the engine concluded.
 */
function saysSomething(file: FileAnnotation): boolean {
  return (
    file.findings.length > 0 || file.notVerified.length > 0 || file.viaReceipt.length > 0
  );
}

function row(file: FileAnnotation, prose: ReadonlyMap<string, string> | undefined): string[] {
  const lines = [
    saysSomething(file)
      ? `- ${MARK[file.criticality]} \`${file.path}\` — ${file.reason}`
      : `- ${MARK[file.criticality]} \`${file.path}\``,
  ];

  if (file.criticality === "review") {
    lines.push(...detailBlock(file.findings));
    // The ONE place LLM text enters the body. Quoted, so it is visibly a judgement
    // and not an engine fact.
    const why = prose?.get(file.path);
    if (why !== undefined && why.trim() !== "") lines.push(`  > ${why.trim()}`);
  }

  return lines;
}

export function renderBody(annotation: Annotation, options: RenderOptions = {}): string {
  const { counts, files } = annotation;
  const lines: string[] = [BODY_START, "## Whetstone — where to look", ""];

  if (files.length === 0) {
    lines.push(
      "This change touches **no files**, so nothing was verified and there is nothing to review.",
      "",
      BODY_END,
      "",
    );
    return lines.join("\n");
  }

  const noun = files.length === 1 ? "file" : "files";
  // Words, not marks. A legend reading "🔴 0 review" puts a red dot on a PR that has
  // nothing red in it, which is exactly the signal dilution this layer exists to
  // avoid — and it makes "how many red things are on this page" un-countable.
  lines.push(
    `**${annotation.tier}** tier · ${String(files.length)} ${noun} · ` +
      `${String(counts.review)} to review, ${String(counts.skim)} to skim, ` +
      `${String(counts.skip)} trivial`,
  );
  if (options.range !== undefined) lines.push("", `Gate range: \`${options.range}\``);
  lines.push("");

  const review = files.filter((f) => f.criticality === "review");
  const skim = files.filter((f) => f.criticality === "skim");
  const skip = files.filter((f) => f.criticality === "skip");

  if (review.length > 0) {
    lines.push(`### ${MARK.review} Look here (${String(review.length)})`, "");
    for (const file of review) lines.push(...row(file, options.prose));
    lines.push("");
  }

  if (skim.length > 0) {
    lines.push(
      `### ${MARK.skim} Worth a skim (${String(skim.length)})`,
      "",
      // The shared explanation, ONCE. Every row that adds nothing to it is just a
      // path; rows that do add something carry their reason inline.
      "Critical-path files where no finding was reported against this change, plus " +
        "advisory findings. Glance to confirm the intent — not to hunt for bugs.",
      "",
    );
    for (const file of skim) lines.push(...row(file, options.prose));
    lines.push("");
  }

  // THE COLLAPSE. One line, count only — see the header comment.
  if (skip.length > 0) {
    const trivial = skip.length === 1 ? "file" : "files";
    lines.push(
      `${MARK.skip} ${String(skip.length)} trivial/doc ${trivial}, checks OK — nothing here needs you.`,
      "",
    );
  }

  if (annotation.unattributed.length > 0) {
    lines.push(
      "### Not localised",
      "",
      "These failures are real, but they name no file in this change — we will not guess:",
      "",
    );
    for (const finding of annotation.unattributed) {
      lines.push(`- \`${finding.checkId}\`: ${(finding.detail.split("\n")[0] ?? "").trim()}`);
    }
    lines.push("");
  }

  if (annotation.notVerified.length > 0) {
    // Load-bearing wording, borrowed verbatim in spirit from `gate/report.ts`: these
    // are neither failures nor successes, and a reader who reads them as either is
    // being misled.
    lines.push(
      `> **NOT fully verified.** The gate could not run: ${annotation.notVerified
        .map((id) => `\`${id}\``)
        .join(", ")}. That is the gate being broken, not a judgement about this change.`,
      "",
    );
  }

  lines.push(
    annotation.blocking
      ? "_Whetstone requests changes: strict tier with a correctness-class finding._"
      : "_Whetstone is commenting, not gating. The gate's exit code is the enforcement channel._",
    "",
    BODY_END,
    "",
  );

  return lines.join("\n");
}

/**
 * Replace the managed block, or append it. NEVER a second copy.
 *
 * The author's own prose on both sides is preserved byte-for-byte: the PR body is
 * theirs, and a tool that overwrites it will be turned off within a day.
 */
export function upsertManagedBlock(existing: string, block: string): string {
  const start = existing.indexOf(BODY_START);
  const end = existing.indexOf(BODY_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + BODY_END.length);
    return `${before}${block.trimEnd()}${after}`;
  }

  const trimmed = existing.trimEnd();
  return trimmed === "" ? block : `${trimmed}\n\n${block}`;
}

// ── inline comments ──────────────────────────────────────────────────────────

/**
 * One review comment, in the shape GitHub's create-review endpoint accepts.
 *
 * Verified against the OpenAPI description for
 * `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`: the `comments` array
 * takes `path` (required), `body` (required), `line`, `side`, `start_line`,
 * `start_side`. `position` is closing down and is not used.
 *
 * `line` is OMITTED, not nulled, when the finding gave none — an absent line with
 * `subject_type: "file"` is a file-level comment; `line: null` is a 422.
 */
export interface ReviewComment {
  readonly path: string;
  readonly body: string;
  readonly line?: number;
  readonly side?: "LEFT" | "RIGHT";
  readonly subject_type?: "line" | "file";
  /** Not sent to GitHub — it is embedded in `body`. Kept out for the dedup test. */
  readonly fingerprint: string;
}

export function inlineComments(
  annotation: Annotation,
  prose?: ReadonlyMap<string, string>,
): ReviewComment[] {
  const out: ReviewComment[] = [];

  for (const file of annotation.files) {
    // 🔴 ONLY. Everything else is in the body, where it costs no notification.
    if (file.criticality !== "review") continue;

    for (const finding of file.findings) {
      const fp = fingerprint({
        checkId: finding.checkId,
        path: file.path,
        detail: finding.detail,
        ...(finding.line !== undefined ? { line: finding.line } : {}),
      });

      const why = prose?.get(file.path);
      const body = [
        `${MARK.review} **\`${finding.checkId}\`** — look here.`,
        "",
        ...(why !== undefined && why.trim() !== "" ? [why.trim(), ""] : []),
        "```",
        finding.detail.split("\n").slice(0, 20).join("\n"),
        "```",
        "",
        `<!-- ${fp} -->`,
      ].join("\n");

      out.push({
        path: file.path,
        body,
        ...(finding.line !== undefined
          ? { line: finding.line, side: "RIGHT" as const, subject_type: "line" as const }
          : { subject_type: "file" as const }),
        fingerprint: fp,
      });
    }
  }

  return out;
}

/** Anything with a body — a review comment already on the PR, however it was fetched. */
export interface PostedComment {
  readonly body: string;
}

// ── the review itself ────────────────────────────────────────────────────────

export interface ReviewSummary {
  readonly event: Annotation["event"];
  readonly body: string;
  readonly digest: string;
}

/**
 * The top-level review — one short paragraph, plus a digest of the annotation it
 * was computed from.
 *
 * The digest exists because GitHub reviews are append-only. `wst pr` runs on every
 * push; without it, a PR touched ten times would carry ten identical
 * "requests changes" reviews, and the eleventh would be indistinguishable from
 * noise. `shouldPostReview` turns "have I already said exactly this?" into a pure
 * comparison the adapter cannot get wrong.
 *
 * What goes INTO the digest is the annotation's conclusions — the event, and every
 * file's criticality and findings — and deliberately not the rendered markdown, so
 * rewording this template does not re-review every open PR.
 */
export function reviewSummary(annotation: Annotation): ReviewSummary {
  const canonical = [
    "wst-review/1",
    annotation.event,
    annotation.tier,
    ...annotation.files.map(
      (file) =>
        `${file.criticality}\0${file.path}\0${file.findings
          .map((finding) =>
            fingerprint({
              checkId: finding.checkId,
              path: file.path,
              detail: finding.detail,
              ...(finding.line !== undefined ? { line: finding.line } : {}),
            }),
          )
          .join(",")}\0${file.notVerified.join(",")}`,
    ),
    ...annotation.unattributed.map((finding) => `!\0${finding.checkId}\0${finding.detail}`),
  ].join("\n");

  const digest = `${FP_PREFIX}${createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, 16)}`;

  const headline = annotation.blocking
    ? `${MARK.review} ${String(annotation.counts.review)} file(s) need a look before this merges.`
    : annotation.counts.review > 0
      ? `${MARK.review} ${String(annotation.counts.review)} file(s) worth a look. Not gating — this is a ${annotation.tier}-tier change.`
      : annotation.clean && annotation.notVerified.length === 0
        ? "No findings. The map is in the PR description."
        : "No findings landed on a specific file. See the PR description.";

  const body = [
    headline,
    "",
    `${String(annotation.counts.review)} to review · ${String(annotation.counts.skim)} to skim · ${String(annotation.counts.skip)} trivial.`,
    "",
    `<!-- ${digest} -->`,
  ].join("\n");

  return { event: annotation.event, body, digest };
}

/** Have we already posted exactly this review? THE review-level idempotency rule. */
export function shouldPostReview(digest: string, posted: readonly PostedComment[]): boolean {
  return !posted.some((review) => review.body.includes(digest));
}

/**
 * Drop comments the PR already carries. THE idempotency rule.
 *
 * Matching on the fingerprint rather than on the rendered text means a change to the
 * wording of our own template does not re-post every comment on every PR.
 */
export function pruneAlreadyPosted(
  comments: readonly ReviewComment[],
  posted: readonly PostedComment[],
): ReviewComment[] {
  const seen = new Set<string>();
  for (const comment of posted) {
    for (const match of comment.body.matchAll(new RegExp(`${FP_PREFIX}[0-9a-f]{16}`, "g"))) {
      seen.add(match[0]);
    }
  }
  return comments.filter((comment) => !seen.has(comment.fingerprint));
}
