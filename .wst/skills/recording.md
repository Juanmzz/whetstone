---
id: recording
version: 2
status: active
---
# Recording

What to write to the project's memory, when, and who confirms the write. This is the discipline
that answers "how does the agent know what to save". It is rules with triggers, not vibes, and
never a silent write.

## Rules

1. [RC1] Record a **decision** (an entry in `memory/decisions.md`) when a choice with real
   tradeoffs is resolved AND the losing option was plausible enough that someone would propose
   it again in three months. Write down **what was rejected and why**, because that is the part git
   cannot reconstruct, since a rejected option has no commit. No rejected alternative means no
   decision: it is a commit message. Propose it; the human confirms.
2. [RC2] Record an **signal** (a line in `memory/signals.jsonl`) when something went wrong or
   nearly did: a correction from the human, a bug's root cause, a triage miss, a slip
   (wrong cwd, scope creep, a test skipped on a strict path).
3. [RC3] **The write is human-gated.** The agent DETECTS and PROPOSES ("this looks like an
   signal / a decision, log it?"); the human confirms before anything is written. Never write
   to memory silently: a hallucinated or premature record poisons every future session and every
   retro that reads it.
4. [RC4] Record **at the moment**, proactively. Do not wait to be asked, and do not batch at
   session end (the detail is gone by then). The one batched exception is the session summary.
5. [RC5] Do **not** record what is re-derivable: code (it's in git), file trees, command output,
   anything a `grep` would reconstruct. Record the WHY and the non-obvious.
6. [RC6] Corrections are **new entries, never edits.** The signal log is append-only; a
   fix to an earlier record is a new line with `supersedes`. A decision changes by moving its
   `status` (`proposed` → `accepted` → `superseded by adr-NNNN`), never by rewriting the prose
   above it, and later commentary goes in a NEW entry rather than into an old one's voice.
   **Compacting an entry is selecting, not editing:** dropping a paragraph is allowed, rewording
   one into something the decision did not say is not.
7. [RC7] Tag each signal with `rule_affected` when you can, because that is the signal the retro groups
   on. Empty is allowed (the retro will attempt to classify it).
8. [RC8] **Session close:** before declaring work done, write a session summary (decisions made,
   blockers, next steps) to the substrate.

## Backend is separate from discipline

This skill governs the WRITE (what/when/gate). The backend governs STORAGE and RECALL. With the
default `files` backend the write is an append/commit; with an adapter (e.g. engram) it's a `save`
call and you get smart recall on top, but the triggers above are identical either way. Smart
recall never replaces the trigger rules; it sits on top of them. The backend is an
interface, and the discipline does not change when the backend does.

## Changelog

- v2 (2026-08-14, adr-0017 + adr-0019): [RC1] gains the bar — a decision needs a plausible
  rejected alternative, and what it rejected is what gets written down; decisions live as
  entries on `memory/decisions.md`, not as files in a directory. [RC6] states the status
  transitions and the compaction rule: selecting is allowed, rewording is not, and later
  commentary is a new entry.
- v1 (2026-07-11, init): generated from a mature workspace's memory save protocol ("When to Save" +
  session-summary gate). Stripped its host-specifics (backend tool names, that project's
  project anchor, topic-key scheme, sensitivity tags). Kept the proactive-save triggers and the
  session-close summary. ADDED the explicit human gate on every write — the `memory-poisoning`
  guard (per `adr-0003`, and the two questions it leaves open:
  what validates a signal BEFORE it may amend a rule, and what stops a hallucinated signal becoming
  a rule diff a human rubber-stamps). Made backend-agnostic per `adr-0001`.
  No signal receipts yet.
