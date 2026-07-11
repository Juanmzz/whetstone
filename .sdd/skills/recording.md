---
id: recording
version: 1
status: active
---
# Recording

What to write to the project's memory, when, and who confirms the write. This is the discipline
that answers "how does the agent know what to save" — it's rules with triggers, not vibes, and
never a silent write.

## Rules

1. [RC1] Record a **decision** (an ADR in `memory/decisions/`) when a choice with real tradeoffs
   is resolved: architecture, data model, API contract, tooling, or any design fork where the
   losing option was plausible. Propose it; the human confirms.
2. [RC2] Record an **signal** (a line in `memory/signals.jsonl`) when something went wrong or
   nearly did: a correction from the human, a bug's root cause, a triage miss, a slip
   (wrong cwd, scope creep, a test skipped on a strict path).
3. [RC3] **The write is human-gated.** The agent DETECTS and PROPOSES ("this looks like an
   signal / a decision — log it?"); the human confirms before anything is written. Never write
   to memory silently — a hallucinated or premature record poisons every future session and every
   retro that reads it.
4. [RC4] Record **at the moment**, proactively — do not wait to be asked, and do not batch at
   session end (the detail is gone by then). The one batched exception is the session summary.
5. [RC5] Do **not** record what is re-derivable: code (it's in git), file trees, command output,
   anything a `grep` would reconstruct. Record the WHY and the non-obvious.
6. [RC6] Corrections are **new entries, never edits.** Signals are append-only (SPEC §2.1); a
   fix to an earlier record is a new line with `supersedes`. Decisions supersede by status, not by
   overwrite.
7. [RC7] Tag each signal with `rule_affected` when you can — that is the signal the retro groups
   on. Empty is allowed (the retro will attempt to classify it).
8. [RC8] **Session close:** before declaring work done, write a session summary (decisions made,
   blockers, next steps) to the substrate.

## Backend is separate from discipline

This skill governs the WRITE (what/when/gate). The backend governs STORAGE and RECALL. With the
default `files` backend the write is an append/commit; with an adapter (e.g. engram) it's a `save`
call and you get smart recall on top — but the triggers above are identical either way. Smart
recall never replaces the trigger rules; it sits on top of them (ADR-0001).

## Changelog

- v1 (2026-07-11, init): generated from the ChytaPay Engram save protocol ("When to Save" +
  session-summary gate). Stripped ChytaPay-specifics (engram tool names, the `chytapay-workspace`
  project anchor, topic-key scheme, sensitivity tags). Kept the proactive-save triggers and the
  session-close summary. ADDED the explicit human gate on every write — the `memory-poisoning`
  guard (per [[0003-positioning-human-gated-not-autonomous]] and OPEN_QUESTIONS #5/#6). Made
  backend-agnostic per [[0001-memory-is-an-interface]]. No signal receipts yet.
