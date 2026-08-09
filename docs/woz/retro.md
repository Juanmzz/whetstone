---
id: retro
version: 0
status: alpha
---
# Whetstone retro

> **WoZ-era reference (ADR-0008).** Superseded as a procedure; retained as the working
> specification for **Step 7** (`wst retro`). This is the loop that produced TD6 — the validation
> ADR-0008 rests on. The code must reproduce it, including the anti-poisoning gate in §4.

The feedback loop's engine. Where `init.md` INSTALLS a project's guardrails, `retro.md`
IMPROVES them: it reads the friction a project actually hit and **recommends the apparatus that
project needs** — amend a rule, curate a proven skill, generate a project-specific hook/command,
or graduate an advisory rule to an enforced one. Every write is human-gated.

**How to run:** from the project's own repo, tell the agent *"run the Whetstone retro"* (read
`<path-to>/whetstone/retro.md`). It reads that repo's `.sdd/memory/`, never Whetstone's.

**When to run:** at a natural checkpoint — `wst.yaml`'s `retro.suggest_after` count of new
signals, a context-compaction boundary, or a milestone. Not after every signal (noise); not
never (the tail of lessons is where the value is).

---

## 0. Preconditions

1. Confirm the cwd is the target project (not Whetstone). The retro reads and writes THIS
   project's `.sdd/`.
2. Read `.sdd/memory/retro-log.md` for the **cursor** — the last signal id a prior retro
   processed. Only signals AFTER the cursor are new. If no prior retro, all signals are new.

## 1. Read the new signals

Read `.sdd/memory/signals.jsonl` from the cursor forward. Also skim recent `decisions/` (ADRs) —
a decision can be the "theirs" a signal argues against. Do NOT read source unless a signal
points you at a specific file.

## 2. Cluster — find the patterns, not the incidents

Group the new signals by what they implicate:
- by `rule_affected` (the strongest signal — several signals naming one skill);
- by `type` and `phase` (a recurring `triage-miss` in `apply`, a repeated `tooling-slip`);
- by a **meta-pattern** a human would name across types (e.g. "the review keeps catching the
  same class of bug"). This is the highest-value cluster — sig-0009 in the reference dogfood
  was exactly this, and it produced TD6.

A cluster of ONE low-severity signal is usually not yet actionable — note it, leave it for the
next retro. Recurrence is the trigger — **except a single `high`-severity signal is a candidate on
its own** (don't wait for it to recur; SPEC §3.4 step 3).

## 3. For each cluster — form ONE recommendation

This is the engine. Map the cluster to the apparatus that would prevent its recurrence:

| The cluster looks like… | Recommend… |
| --- | --- |
| a rule was ignored / too weak / missing a case | **amend** the skill (add/strengthen a rule) |
| the SAME advisory rule ignored repeatedly despite amendment | **graduate** it to an enforced **hook** (advisory → enforced; see `init.md` §4b) |
| a repeated manual sequence | a **command** — curate a template if one fits, else generate one for this project |
| a general discipline gap with a proven solution in the wild | **curate** an existing skill (don't reinvent — [[lazy]]) |
| a project-specific gap nothing off-the-shelf covers | **generate** a tailored skill/hook |
| a decision was wrong or overtaken | propose flipping/superseding the **ADR** (never silently) |

Prefer curate over generate, and the smallest apparatus that fixes it (a rule beats a hook beats
a command beats a new skill). One recommendation per cluster; if a cluster needs two, it was two
clusters.

## 4. Validate BEFORE proposing (the anti-poisoning gate)

The retro's proposal is agent-generated — a hallucinated signal must not become a rubber-stamped
rule (OPEN_QUESTIONS #6). Before proposing, for each recommendation confirm:
- the signals it rests on are REAL (the events happened — check the detail against the repo/git
  if unsure);
- the recommendation actually addresses the root cause, not the symptom;
- it does not contradict the constitution (which the retro never amends — SPEC §3.1).
If a recommendation fails this, drop it and say why.

## 5. Propose to the human (the gate)

Present each surviving recommendation as: **the cluster (which signals) → the proposed change →
the exact diff/new file.** The human approves, edits, or rejects each independently. Nothing is
written before approval. This is ADR-0003 — the human gate is the moat, not a formality.

## 6. Apply the approved changes

- **Amend a skill:** apply the diff, **bump `version`**, add a `## Changelog` entry that cites
  the signals as the **receipt** (e.g. "from sig-0006 / sig-0009"). A rule with a receipt is
  earned; a rule without one is a guess.
- **New skill/hook/command:** write it following the payload's format; register it in `wst.yaml`
  (and, for the code tier, re-run the relevant `init.md` §4b emitter step).
- **Flip an ADR:** set `status: superseded` and write the new ADR; never edit the old prose (ADR-0007).
- **In all cases:** set `resolved_by` on each signal this change resolved (the amendment/skill id —
  §2.1 permits this machinery-owned back-pointer). **Distill:** if a finding surfaced a cross-skill
  observation that maps to no single rule, add it to `.sdd/memory/patterns.md`.

## 7. Flag for upstream contribution (ADR-0006)

If an amendment is generic (would help any project, not just this one), mark it in the changelog
as a **contribution candidate**. A generic amendment earned here should flow to Whetstone's
canonical skill — the same 3-way-merge machinery, pointed upstream. (In the alpha this is a hand
step; the updater automates it.)

## 8. Close the loop — update the retro-log

Append a `## Retro NNNN` entry to `.sdd/memory/retro-log.md`: date, trigger, signals read (the
new cursor), findings, amendments applied, contribution candidates, and what was consciously
deferred. The cursor it records is where the NEXT retro starts.

## Changelog

- v0 (2026-07-13, draft): first retro playbook. Wizard-of-Oz — the procedure IS the engine, no
  code tool yet. Extracted from the reference dogfood, whose ad-hoc Retro 0002 produced the first
  earned rule (tdd-discipline TD6) and proved the loop before this was written down.
