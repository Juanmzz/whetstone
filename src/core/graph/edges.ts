/**
 * The provenance graph, derived rather than stored.
 *
 * PURE. Text in, edges out — no filesystem, no database, no index.
 */

import { DEFINITION_DIR } from "../paths.js";
import { parseDecisions } from "../decisions/anchors.js";

export type EdgeKind =
  /** A signal names the rule it implicates, in `rule_affected`. */
  | "signal-affects-rule"
  /**
   * A rule mentions a signal id somewhere in its prose.
   *
   * NOT a provenance claim, which is why nothing here treats it as one. Measured
   * across this repo's eight skills, the same syntax carries three meanings: the
   * signal that earned the rule, an EXAMPLE of the pattern the rule is about
   * (`lazy.md` cites five signals that each earned a different rule), and an id
   * from ANOTHER repo's log entirely (`tdd-discipline.md` says so in the same
   * sentence). Reading all three as "this earned me" reported eight
   * contradictions where one existed.
   */
  | "rule-mentions-signal"
  /** A check names the decision it rests on, in `origin:`. A declared field. */
  | "check-rests-on-decision";

export interface Edge {
  readonly kind: EdgeKind;
  readonly from: string;
  readonly to: string;
  /** Which document asserted this relationship. The whole point of the field. */
  readonly sourceDoc: string;
}

/** The four texts the graph is read from. Supplied by the shell; none is optional. */
export interface Corpus {
  /** `.wst/memory/signals.jsonl`, verbatim. */
  readonly signals: string;
  /** Skill path (`skills/lazy.md`) → its text. */
  readonly skills: Readonly<Record<string, string>>;
  /** Check path (`checks/test.md`) → its text. */
  readonly checks: Readonly<Record<string, string>>;
  /** `.wst/memory/decisions.md`, verbatim. */
  readonly decisions: string;
}

export type ContradictionKind =
  /** A check rests on a decision that has been superseded. */
  "stale-foundation";

export interface Contradiction {
  readonly kind: ContradictionKind;
  /** The file to change. Never the file that merely disagrees with it. */
  readonly path: string;
  readonly detail: string;
}

const SIGNAL_ID = /\bsig-[0-9a-z]{4,8}\b/g;
const ORIGIN_ADR = /^origin:.*$/m;
const ADR_ID = /\badr-\d{4}\b/g;

interface SignalRow {
  readonly id: string;
  readonly rules: readonly string[];
}

function signalRows(jsonl: string): readonly SignalRow[] {
  const rows: SignalRow[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as { id?: string; rule_affected?: string[] };
      if (typeof parsed.id !== "string") continue;
      rows.push({ id: parsed.id, rules: parsed.rule_affected ?? [] });
    } catch {
      // A malformed line is `signals`' problem, not this one. Parsing it twice to
      // report the same defect twice helps nobody.
    }
  }
  return rows;
}

/** Every relationship the corpus declares, each carrying the file that declared it. */
export function edgesOf(corpus: Corpus): readonly Edge[] {
  const edges: Edge[] = [];

  for (const row of signalRows(corpus.signals)) {
    for (const rule of row.rules) {
      edges.push({
        kind: "signal-affects-rule",
        from: row.id,
        to: rule,
        sourceDoc: `${DEFINITION_DIR}/memory/signals.jsonl`,
      });
    }
  }

  for (const [path, text] of Object.entries(corpus.skills)) {
    for (const id of new Set(text.match(SIGNAL_ID) ?? [])) {
      edges.push({
        kind: "rule-mentions-signal",
        from: path,
        to: id,
        sourceDoc: `${DEFINITION_DIR}/${path}`,
      });
    }
  }

  for (const [path, text] of Object.entries(corpus.checks)) {
    const origin = ORIGIN_ADR.exec(text)?.[0] ?? "";
    for (const id of new Set(origin.match(ADR_ID) ?? [])) {
      edges.push({
        kind: "check-rests-on-decision",
        from: path,
        to: id,
        sourceDoc: `${DEFINITION_DIR}/${path}`,
      });
    }
  }

  return edges;
}

/**
 * Where a document rests on something that has moved under it.
 *
 * ONE rule, deliberately. A check's `origin:` is a declared field with a single
 * meaning, so "it names a superseded decision" is a fact. The tempting second
 * rule — a skill citing a signal that does not cite it back — was written, run,
 * and removed: `rule-mentions-signal` is ambiguous by construction, and the rule
 * reported eight problems where one was real.
 *
 * What would make it checkable is a way for a skill to say WHICH of its citations
 * are provenance. That is a change to how rules are written, so it belongs to the
 * retro and a human, not to a parser.
 *
 * Also deliberately unreported: a signal with an empty `rule_affected`. `[RC7]`
 * says empty is allowed — it is a signal the retro has not classified yet.
 */
export function contradictionsIn(corpus: Corpus): readonly Contradiction[] {
  const edges = edgesOf(corpus);
  const found: Contradiction[] = [];

  const status = new Map(parseDecisions(corpus.decisions).entries.map((d) => [d.id, d.status]));
  for (const e of edges) {
    if (e.kind !== "check-rests-on-decision") continue;
    const state = status.get(e.to) ?? "";
    if (!state.startsWith("superseded")) continue;
    found.push({
      kind: "stale-foundation",
      path: e.sourceDoc,
      detail: `rests on ${e.to}, which is ${state}. The reason it gives for existing was retired.`,
    });
  }

  return found;
}
