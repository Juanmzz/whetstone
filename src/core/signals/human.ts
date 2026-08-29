/**
 * A signal a HUMAN recorded, built and validated. PURE.
 */

import { DEFINITION_DIR } from "../paths.js";
import { signalId, type SignalSeverity } from "./emit.js";
import type { SignalRecord } from "./parse.js";

export interface HumanObservation {
  readonly type: string;
  readonly phase: string;
  /** Unvalidated as it arrives from a CLI; checked against the scale below. */
  readonly severity: string;
  readonly detail: string;
  readonly ruleAffected?: readonly string[];
  /** From the git adapter. `null` on a detached HEAD. */
  readonly branch: string | null;
  /**
   * Whether anything actually EVIDENCED a human at the keyboard.
   *
   * REQUIRED, not optional, and the reason is the same one `appendSignals` gives
   * for `branch`: a new caller has to answer the question rather than inherit the
   * log's strongest provenance class by omission (the header has why that class
   * has to be earned). What counts as evidence is the command's to decide,
   * because it is the layer that can see a terminal.
   */
  readonly attested: boolean;
  /**
   * The human's OWN WORDS, verbatim, when an agent drafted this from something
   * they said (adr-0035). `attested` asks only whether a terminal existed, which
   * this human never has; a quote is checkable against the transcript.
   */
  readonly quote?: string;
}

/**
 * An agent drafted it from what the human said; the human said yes to the draft.
 *
 * NOT `human` (adr-0035 refused to reuse it): composing a record and approving one
 * are different acts, and that difference is the whole job of `source`.
 */
const QUOTED: string = "human-quoted";

export type HumanSignalResult =
  | { readonly ok: true; readonly record: SignalRecord }
  | { readonly ok: false; readonly errors: readonly string[] };

const SEVERITIES = ["low", "medium", "high"] as const;

/**
 * What `wst signal` records when nobody says where it happened.
 *
 * `other` rather than a guess. The phase is what a retro clusters on, and a
 * wrong one is a signal filed under a stage it never touched. Beside the scale
 * because `cli.ts` hands both to Commander as the flag defaults, and a literal
 * in each place is two answers with nothing to notice when they diverge.
 */
export const DEFAULT_PHASE = "other";

/**
 * The middle of the scale. `high` is deliberately not the default: `clusterSignals`
 * treats a lone `high` as actionable on its own, so defaulting to it would let an
 * unconsidered flag drive a rule proposal by itself.
 */
export const DEFAULT_SEVERITY: SignalSeverity = "medium";

/**
 * Narrowing rather than an `as SignalSeverity` cast. The cast made the check above
 * it decorative: change the scale in one place and the record still carries
 * whatever the CLI passed, typed as something it is not.
 */
const isSeverity = (value: string): value is SignalSeverity =>
  (SEVERITIES as readonly string[]).includes(value);

/**
 * A `.wst`-relative path to a markdown rule file: `skills/recording.md`,
 * `triage-rules.md`, `memory/decisions.md`. Kebab-case segments,
 * no `.` or `..`, because the string is written into a permanent record and read
 * back as a path by the retro (`commands/retro.ts` reads `.wst/<rule>`).
 */
const RULE = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/**
 * The rule documents that live at the ROOT of `.wst/` rather than under `skills/`.
 * Named explicitly so a bare filename can be resolved without guessing: everything
 * else with no directory is a skill, which is what all 44 accumulated entries mean
 * when they write one.
 */
const SDD_ROOT_RULES: readonly string[] = ["architecture.md", "constitution.md", "triage-rules.md"];

/**
 * One spelling per rule. `clusterSignals` buckets on `rule:<path>` VERBATIM and only
 * calls a group of two actionable, so `recording.md` and `skills/recording.md` are
 * two clusters of one and the evidence produces nothing. This is the discipline the
 * kebab-case `type` regex already applies, on the axis the retro leans on hardest.
 */
function canonicalRule(raw: string): string {
  const path = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
  if (path === "" || path.includes("/")) return path;
  return SDD_ROOT_RULES.includes(path) ? path : `skills/${path}`;
}

/**
 * Open vocabulary, kebab-case (SPEC §2.1). Enforced because `clusterSignals`
 * buckets on `type:<name>` verbatim: `Triage Miss` and `triage-miss` become two
 * clusters over one problem, and a cluster of one is never actionable.
 */
const TYPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Every problem at once. A human recording an observation is mid-thought and
 * mid-task; three round trips to learn three things is how a command stops being
 * used, and an unused recording command returns us to a hand-written log.
 */
export function humanSignal(input: HumanObservation, now: Date): HumanSignalResult {
  const type = input.type.trim();
  const phase = input.phase.trim();
  const detail = input.detail.trim();
  // Trimmed like every other field. It was the one exception, so `-s high ` was
  // rejected while ` triage-miss ` was accepted — the same shell, the same accident.
  const severity = input.severity.trim();
  // NOT canonicalised the way the cluster keys are: reflowing evidence turns the
  // human's words into someone else's. Outer whitespace is the shell's, not theirs.
  const quote = input.quote?.trim();
  // Deduped AFTER canonicalisation. Two spellings of one rule would otherwise put
  // the same signal in the same bucket twice, and `group.length >= 2` reads that as
  // recurrence: one observation wearing the shape of two.
  const rules = [...new Set((input.ruleAffected ?? []).map(canonicalRule))].filter((r) => r !== "");
  const errors: string[] = [];

  if (!TYPE.test(type)) {
    errors.push(
      `type "${input.type}" is not kebab-case (e.g. \`triage-miss\`): the retro clusters on it verbatim`,
    );
  }
  if (phase === "") {
    errors.push("phase is empty: say where it happened (init, plan, apply, verify, review, …)");
  }
  if (!isSeverity(severity)) {
    errors.push(`severity "${input.severity}" is not one of ${SEVERITIES.join("/")}`);
  }
  if (detail === "") {
    errors.push("detail is empty: a signal nobody can reconstruct the event from is not evidence");
  }
  if (input.quote !== undefined && quote === "") {
    errors.push(
      "quote is empty: the words ARE the provenance here, so a record claiming a quote it does " +
        "not carry claims nothing",
    );
  }
  for (const rule of rules) {
    if (!RULE.test(rule)) {
      errors.push(
        `rule "${rule}" is not a ${DEFINITION_DIR}-relative markdown path (e.g. \`skills/recording.md\`): ` +
          `the retro reads it as a path and clusters on it verbatim`,
      );
    }
  }

  // The second clause is unreachable when `errors` is empty; it is there so the
  // record below gets a narrowed `severity` instead of an unchecked cast.
  if (errors.length > 0 || !isSeverity(severity)) return { ok: false, errors };

  return {
    ok: true,
    record: {
      // Seeded with the timestamp as well as the content, so recording the same
      // observation twice on purpose gives two entries. Recurrence is what the
      // retro reasons over, and a human logging it again is asserting exactly that.
      // Seeded with the quote when there is one, so editing the words in an
      // append-only log leaves an id that no longer hashes to the line beside it.
      id: signalId(
        `human:${now.toISOString()}:${type}:${detail}` +
          (quote !== undefined && quote !== "" ? `:${quote}` : ""),
      ),
      ts: now.toISOString(),
      type,
      phase,
      severity,
      detail,
      ...(input.branch !== null ? { branch: input.branch } : {}),
      rule_affected: rules,
      // Carried on every class, not just the one that rests on it: dropping the
      // words would be the paraphrase arriving by another door.
      ...(quote !== undefined && quote !== "" ? { quote } : {}),
      // Strongest evidence wins, and typing outranks quoting: someone at a terminal
      // composed this themselves. `cli` is the floor, never absent — absent is what
      // the agent-written entries look like.
      source: input.attested ? "human" : quote !== undefined && quote !== "" ? QUOTED : "cli",
    },
  };
}
