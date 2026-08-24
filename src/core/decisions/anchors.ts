/**
 * Parses `.wst/memory/decisions.md` into its entries.
 *
 * PURE. Text in, entries and problems out — no I/O, no clock, no process.
 *
 * WHAT IT DOES NOT DO: judge the prose. Whether an entry states its rejected
 * alternative well is a reader's call and a retro's (adr-0019). Whether it has a
 * status is a fact.
 */

/**
 * `### adr-0011 — build the event log`
 *
 * The separator may be an em dash, an en dash or a colon. It is a delimiter, not
 * prose, and requiring one character made the payload unshippable to a project
 * whose conventions forbid it — `init`'s seeded example was rewritten with a
 * colon, and every repo bootstrapped from it would have carried an anchor its own
 * parser rejects. What is NOT optional is having a separator: without one there
 * is no boundary between the id and the title.
 */
const ANCHOR = /^### (adr-(\d{4}))\s*(?:[—–]|:)\s+(\S.*)$/;

/**
 * The line under an anchor: status, then the date the decision was taken, then
 * optional provenance. `status` is what a retro flips and what tells a reader
 * whether a decision is in force; both are required by adr-0019, and both are the
 * kind of field that goes missing quietly.
 *
 *     `accepted` · 2026-08-09
 *     `superseded by adr-0019` · 2026-07-14 · rules: retro.md
 */
const META = /^`(proposed|accepted|superseded by adr-\d{4})` · (\d{4}-\d{2}-\d{2})((?: · .+)?)$/;

/**
 * A decision taken and not yet true of the code.
 *
 * `accepted` says what was decided; it has never said whether anything implements
 * it. adr-0006 read `accepted` for six weeks while nothing merged.
 */
const UNBUILT = /(?:^|\s·\s)unbuilt(?:\s|$)/;

export interface DecisionEntry {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly date: string;
  /** Decided, and not fully true of the code. The entry says how much. */
  readonly unbuilt: boolean;
  /** Everything under the meta line, up to the next anchor. */
  readonly body: string;
  /** 1-indexed line of the heading. */
  readonly line: number;
}

export interface AnchorProblem {
  /** 1-indexed line the problem is on. */
  readonly line: number;
  readonly why: string;
}

const pad = (n: number): string => `adr-${String(n).padStart(4, "0")}`;

/**
 * Entries in the order they appear, plus everything wrong with the page.
 *
 * An entry with a bad meta line is still returned: its id resolves for a citation,
 * and the missing status is reported rather than made into a second failure.
 */
export function parseDecisions(page: string): {
  entries: DecisionEntry[];
  problems: AnchorProblem[];
} {
  const entries: DecisionEntry[] = [];
  const problems: AnchorProblem[] = [];
  const seen = new Set<string>();
  const lines = page.split("\n");
  let previous = 0;
  let fenced = false;

  lines.forEach((line, index) => {
    if (line.startsWith("```")) fenced = !fenced;
    // A heading inside a fence is the page showing a reader what an entry looks
    // like, not an entry. Counting it reports the example as a duplicate anchor.
    if (fenced || !line.startsWith("### ")) return;

    const at = index + 1;
    const match = ANCHOR.exec(line);
    if (match === null) {
      problems.push({ line: at, why: `heading is not \`### adr-NNNN — title\`: ${line.trim()}` });
      return;
    }

    const [, id = "", digits = "", title = ""] = match;
    if (seen.has(id)) {
      // Two anchors with one id means a citation resolves to whichever a reader
      // scrolls to first.
      problems.push({ line: at, why: `${id} already has an anchor` });
      return;
    }
    seen.add(id);

    const n = Number(digits);
    if (n !== previous + 1) {
      // Ids are sequential. A gap is a decision that went missing; a step backwards
      // is a page a reader cannot scan.
      problems.push({ line: at, why: `${id} follows ${pad(previous)} — expected ${pad(previous + 1)}` });
    }
    previous = n;

    const meta = META.exec(lines[index + 1] ?? "");
    if (meta === null) {
      problems.push({
        line: at + 1,
        why: `${id} has no meta line — expected \`` + "`accepted` · YYYY-MM-DD" + `\`, found: ${(lines[index + 1] ?? "").trim() || "(blank)"}`,
      });
    }

    // Up to the next anchor at the same level, so a caller can compare the marker
    // against what the prose claims.
    const rest = lines.slice(index + 2);
    const until = rest.findIndex((l) => l.startsWith("### "));
    const body = (until < 0 ? rest : rest.slice(0, until)).join("\n").trim();

    entries.push({
      id,
      title,
      status: meta?.[1] ?? "",
      date: meta?.[2] ?? "",
      unbuilt: UNBUILT.test(meta?.[3] ?? ""),
      body,
      line: at,
    });
  });

  return { entries, problems };
}
