/**
 * How much of what a change ADDS is comment. PURE.
 *
 * An opinion `init` may offer and never seeds unasked (adr-0025). It lives here
 * rather than in a script because a seeded check's `command:` must name something
 * the target repo already has: `npm run check:comments` names a script nobody wrote.
 */

export const MAX_PERCENT = 25;

/** Below this, one comment on a three-line change reads as 33% and means nothing. */
export const MIN_SAMPLE = 15;

/**
 * Which 1-based lines of `source` are comment, by scanning it.
 *
 * A line starting with `*` is a doc continuation or a markdown bullet inside a
 * template literal, and `init` writes hundreds of the second kind. Only a scanner
 * that knows it is inside a string can tell them apart.
 */
export function commentLines(source: string): ReadonlySet<number> {
  const found = new Set<number>();
  let line = 1;
  let block = false;
  let quote: string | null = null;
  let sawCode = false;
  let blockStart = 0;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      if (block && !sawCode) found.add(line);
      line += 1;
      sawCode = false;
      continue;
    }
    if (block) {
      if (c === "*" && next === "/") {
        if (!sawCode) for (let l = blockStart; l <= line; l += 1) found.add(l);
        block = false;
        i += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      sawCode = true;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      sawCode = true;
      continue;
    }
    if (c === "/" && next === "/") {
      if (!sawCode) found.add(line);
      while (i < source.length && source[i] !== "\n") i += 1;
      i -= 1;
      continue;
    }
    if (c === "/" && next === "*") {
      block = true;
      blockStart = line;
      i += 1;
      continue;
    }
    if (c !== " " && c !== "\t") sawCode = true;
  }
  return found;
}

/** The path a `+++` line names, or null for `+++ /dev/null` (a deleted file). */
const targetOf = (line: string): string | null => /^\+\+\+ b\/(.*)$/.exec(line)?.[1] ?? null;

/** Added line numbers per file, read off `--unified=0` hunk headers. */
export function addedLines(diff: string): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = targetOf(line);
      if (file !== null) byFile.set(file, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = byFile.get(file);
    for (let n = start; n < start + count; n += 1) lines?.push(n);
  }
  return byFile;
}

/** Removed comment lines, in the files `keep` accepts. */
export function removedCommentIn(diff: string, keep: (path: string) => boolean): number {
  let file: string | null = null;
  let count = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = targetOf(line);
      continue;
    }
    if (file === null || !keep(file)) continue;
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    const text = line.slice(1).trim();
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) count += 1;
  }
  return count;
}


export interface Density {
  readonly comment: number;
  readonly code: number;
  readonly removedComment: number;
}

export type DensityVerdict =
  | { readonly kind: "net-reduction"; readonly added: number; readonly removed: number }
  | { readonly kind: "too-few"; readonly total: number }
  | { readonly kind: "under"; readonly percent: number; readonly total: number }
  | { readonly kind: "over"; readonly percent: number; readonly total: number };

export function judgeDensity(d: Density): DensityVerdict {
  // A change that ends with fewer comments than it started cannot be the failure
  // this catches, and reads as 100% when it rewrites the few it keeps.
  if (d.removedComment >= d.comment) {
    return { kind: "net-reduction", added: d.comment, removed: d.removedComment };
  }
  const total = d.comment + d.code;
  if (total < MIN_SAMPLE) return { kind: "too-few", total };
  const percent = Math.round((100 * d.comment) / total);
  return percent > MAX_PERCENT ? { kind: "over", percent, total } : { kind: "under", percent, total };
}
