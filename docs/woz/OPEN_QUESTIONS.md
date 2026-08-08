# Open questions

> **Retained as live, not archived (ADR-0008).** Kept tracked because #3 is not a WoZ-era
> question: concurrent `signals.jsonl` writes become a real engineering problem the moment the
> gate emits signals from parallel checks (**Step 3**). #1 lands with the check registry (Step 1).

Design questions to resolve before they become GitHub issues. Kept local while the
project is pre-alpha — no repo ceremony until the thesis is validated (see VISION.md).

Sourced from `docs/woz/SPEC.md` §4.

1. **Signal `type` vocabulary** — open (as spec'd) vs. curated enum with `other`?
   Trade-off: open is friction-free to log but noisy for `Detect`; an enum makes grouping
   reliable but needs maintenance.

2. ~~**Are decisions retro-amendable?**~~ — **RESOLVED (ADR-0007):** yes, via `status` flip
   (proposed → accepted → superseded), human-gated, never editing accepted prose. Constitution
   stays exempt.

3. **Multi-agent writes to `signals.jsonl`** — is append-only + git merge enough, or do
   we need per-session files merged at retro time to avoid concurrent-append conflicts?

4. **Where does the init interview live?** — static questionnaire vs. agent-driven
   conversation with the codebase? (Affects M1 scope directly.)

---

## External research checks

### 2026-07-09 — NotebookLM digest on AI-coding-agent best practices

Cross-checked an external research digest against Whetstone's design. Outcome:

- **Validated the Brick-2 skill set.** The four skills being genericized map 1:1 to
  practices the digest marks CONSENSUS/COMMON: `token-economy` ↔ "4–5 specific rules +
  progressive disclosure (grep/glob just-in-time)"; `tdd-discipline` ↔ "Red-Green-Refactor
  + human review on critical paths (payments/auth)"; `delegation` ↔ "isolate context +
  Result Contracts + atomic-inline vs orchestrator-for-multi-file"; `doc-locations` ↔
  hierarchical `AGENTS.md`/`CLAUDE.md` config in VCS. The four skills are the right four.
- **Reinforced [[0003-positioning-human-gated-not-autonomous]].** The digest documents teams
  letting agents AUTONOMOUSLY write learned rules to persistent memory (Reflexion/Engram
  style), and in the same breath names the failure mode (`memory-poisoning`) and the open
  gap ("validating self-critiques"). That gap is exactly what Whetstone's human gate closes
  — a positioning asset, not a threat.

New questions this raises (park until after Brick 2):

5. **Signal source for the retro loop** — hand-logged signals only, or also distilled from
   session work? The digest's "validating self-critiques" gap is our #4-adjacent question in
   another guise: whatever the loop ingests must be validated BEFORE it can amend a rule, or
   we reproduce `memory-poisoning` ourselves.

6. **Guard against self-poisoning at the write gate** — even human-gated, the retro's
   *proposal* is agent-generated. What check stops a hallucinated signal from becoming a
   proposed rule diff that a human rubber-stamps? Relates to #2 (retro-amendable decisions).
