/**
 * Retro steps 1-2: read the new signals, find the PATTERNS rather than the incidents.
 * PURE — this half is deterministic on purpose.
 *
 * The split that matters (see `.sdd/architecture.md`): clustering is mechanical and
 * belongs to the engine; NAMING the meta-pattern and forming a recommendation is
 * judgment and belongs to the LLM; approving it is the human's. Clustering in code
 * means the evidence behind a proposal is always reproducible — you can re-derive
 * which signals a rule rests on without asking a model to remember.
 */

export type Severity = "low" | "medium" | "high";

export interface Signal {
  readonly id: string;
  readonly ts: string;
  readonly type: string;
  readonly phase: string;
  readonly severity: Severity;
  readonly detail: string;
  readonly rule_affected?: readonly string[];
  /** Machinery-owned back-pointer set when a retro resolves this signal. */
  readonly resolved_by?: string;
}

export interface Cluster {
  /** `rule:<path>` or `type:<name>` — the axis this cluster formed on. */
  readonly key: string;
  readonly signals: readonly Signal[];
  /**
   * Whether this is worth proposing on NOW. Recurrence is the trigger, with one
   * exception: a lone `high` signal qualifies on its own. Waiting for a high-severity
   * problem to recur means waiting for it to happen twice, which is exactly what the
   * retro exists to prevent.
   */
  readonly actionable: boolean;
}

/**
 * Signals after the cursor. The cursor is the last id a previous retro processed.
 */
export function signalsSince(
  all: readonly Signal[],
  cursor: string | null,
): readonly Signal[] {
  if (cursor === null) return [...all];

  const at = all.findIndex((s) => s.id === cursor);
  if (at === -1) {
    // Treating an unknown cursor as "everything is new" would re-propose rules that
    // were already accepted, or already rejected — and a human who sees the same
    // rejected proposal twice stops reading proposals.
    throw new Error(
      `retro cursor "${cursor}" is not in signals.jsonl — the log was edited, or the ` +
        `cursor is corrupt. Resolve by hand before running the retro.`,
    );
  }
  return all.slice(at + 1);
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function clusterSignals(signals: readonly Signal[]): readonly Cluster[] {
  const buckets = new Map<string, Signal[]>();

  const add = (key: string, signal: Signal) => {
    const existing = buckets.get(key);
    if (existing === undefined) buckets.set(key, [signal]);
    else existing.push(signal);
  };

  for (const signal of signals) {
    // A signal implicating two skills belongs to BOTH clusters. Forcing it into one
    // loses the evidence that might make the second cluster actionable.
    for (const rule of signal.rule_affected ?? []) add(`rule:${rule}`, signal);
    add(`type:${signal.type}`, signal);
  }

  const clusters: Cluster[] = [...buckets].map(([key, group]) => ({
    key,
    signals: group,
    actionable:
      group.length >= 2 || group.some((s) => SEVERITY_RANK[s.severity] === SEVERITY_RANK.high),
  }));

  // Drop a `type:` cluster whose signals are entirely covered by a `rule:` cluster.
  // The same signal legitimately lands in both, so without this the retro pays for
  // two LLM proposals over identical evidence and hands the human a duplicate.
  //
  // ONE DIRECTION ONLY. `rule_affected` is the strongest axis (retro.md §2): a rule
  // names the thing that would actually be amended, while `type:` is a label. An
  // earlier version dropped whichever cluster was smaller, and a catch-all
  // `type:generic` bucket promptly swallowed the rule clusters that were the entire
  // point. Two rule clusters never subsume each other either — different rules are
  // different remediation targets even on identical evidence.
  const ruleClusters = clusters.filter((c) => c.key.startsWith("rule:"));
  const kept = clusters.filter((cluster) => {
    if (cluster.key.startsWith("rule:")) return true;
    const ids = cluster.signals.map((s) => s.id);
    return !ruleClusters.some((rule) => {
      const ruleIds = new Set(rule.signals.map((s) => s.id));
      return ids.every((id) => ruleIds.has(id));
    });
  });
  clusters.length = 0;
  clusters.push(...kept);

  // Strongest evidence first: more signals, then higher severity, then a named rule
  // over a bare type. The human reads top-down and should meet the best case first.
  return clusters.sort((a, b) => {
    if (b.signals.length !== a.signals.length) return b.signals.length - a.signals.length;
    const sev = (c: Cluster) => Math.max(...c.signals.map((s) => SEVERITY_RANK[s.severity]));
    if (sev(b) !== sev(a)) return sev(b) - sev(a);
    const named = (c: Cluster) => (c.key.startsWith("rule:") ? 1 : 0);
    if (named(b) !== named(a)) return named(b) - named(a);
    return a.key.localeCompare(b.key);
  });
}
