/**
 * Splitting a diff for the review lens, and combining the verdicts. PURE.
 *
 * Why this exists (sig-0023): the gate sent ONE call carrying the whole matched
 * diff under a fixed budget. Measured on a real 114 KB diff, that call cost $0.607
 * against a $0.50 cap and was killed, so the lens errored. Every strict-tier change
 * therefore rendered "NOT VERIFIED: correctness could not run". The gate was honest
 * about it, which is the only reason it was visible, but the differentiator was
 * inert in practice.
 */

import type { CheckOutcome } from "../contracts.js";

export interface DiffChunk {
  /** Paths carried by this chunk, so a verdict can be attributed back. */
  readonly files: readonly string[];
  /** A VALID standalone diff, never a fragment. */
  readonly diff: string;
  readonly bytes: number;
  /** A single file that exceeds the budget on its own. */
  readonly oversized: boolean;
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;

/**
 * Split on FILE boundaries only. A half-file is not reviewable: the lens would
 * judge a fragment without knowing what the rest of the function does, and would
 * report on it just as confidently. So a file that busts the budget alone stays
 * whole and is flagged `oversized`, letting the caller widen the budget for it
 * rather than silently reviewing half of it.
 */
export function chunkDiff(unifiedDiff: string, maxBytes: number): DiffChunk[] {
  if (unifiedDiff.trim() === "") return [];

  // Split into per-file sections, keeping each header with its body.
  const lines = unifiedDiff.split("\n");
  const sections: { path: string | null; lines: string[] }[] = [];
  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header !== null) {
      sections.push({ path: header[2] ?? header[1] ?? null, lines: [line] });
    } else if (sections.length === 0) {
      sections.push({ path: null, lines: [line] });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }

  const chunks: DiffChunk[] = [];
  let current: { files: string[]; lines: string[]; bytes: number } | null = null;

  const flush = (oversized = false) => {
    if (current === null) return;
    chunks.push({
      files: current.files,
      diff: current.lines.join("\n"),
      bytes: current.bytes,
      oversized,
    });
    current = null;
  };

  for (const section of sections) {
    const text = section.lines.join("\n");
    const bytes = Buffer.byteLength(text, "utf-8");

    if (bytes > maxBytes) {
      flush();
      chunks.push({
        files: section.path === null ? [] : [section.path],
        diff: text,
        bytes,
        oversized: true,
      });
      continue;
    }

    if (current !== null && current.bytes + bytes > maxBytes) flush();
    if (current === null) current = { files: [], lines: [], bytes: 0 };
    if (section.path !== null) current.files.push(section.path);
    current.lines.push(text);
    current.bytes += bytes;
  }
  flush();

  return chunks;
}

/**
 * Combine per-chunk verdicts into one outcome for the check.
 *
 * THE HONESTY RULE: partial coverage is not a pass. If any chunk could not be
 * judged, the change was not fully reviewed, and reporting `pass` would claim
 * verification that never happened. A real finding still wins over an unjudged
 * chunk, because we looked and we found something.
 */
export function aggregateChunkOutcomes(outcomes: readonly CheckOutcome[]): CheckOutcome {
  if (outcomes.length === 0) {
    return { status: "errored", detail: "no chunks were reviewed" };
  }

  const failures = outcomes.filter((o) => o.status === "fail");
  const unjudged = outcomes.filter((o) => o.status === "errored");
  const coverage = `${unjudged.length} of ${outcomes.length} chunk(s) could not be judged`;

  if (failures.length > 0) {
    const details = failures
      .map((f) => (f.status === "fail" ? f.detail : ""))
      .filter(Boolean)
      .join("\n\n");
    return {
      status: "fail",
      detail: unjudged.length > 0 ? `${details}\n\n(${coverage}; unreviewed)` : details,
    };
  }

  if (unjudged.length > 0) {
    const why = unjudged
      .map((o) => (o.status === "errored" ? o.detail : ""))
      .filter(Boolean)
      .join("; ");
    return { status: "errored", detail: `${coverage}: ${why}` };
  }

  return { status: "pass" };
}
