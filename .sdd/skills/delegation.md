---
id: delegation
version: 1
status: active
---
# Delegation

Decide, per action, whether to do it inline or hand it to a fresh-context sub-agent.

## Core principle

Does this inflate the agent's context without need? If yes → delegate. If no → do it inline.

## Rules

1. [D1] Delegate exploration when understanding requires reading 4+ files.
2. [D2] Delegate the write — or run a fresh review before completion — when implementation
   touches 2+ non-trivial files.
3. [D3] Before any commit/push/PR after code changes, run a fresh-context review, unless the
   diff is trivial docs/text.
4. [D4] On any incident (wrong cwd, accidental mutation, merge recovery, env workaround),
   stop, run a fresh audit, then continue.
5. [D5] After roughly 20 tool calls / 5 exploratory reads / 2 non-mechanical edits without
   delegation, pause and delegate.
6. [D6] Use fresh context for adversarial review of diffs, conflicts, and PR readiness — the
   value is independent judgment, not token saving.
7. [D7] Every sub-agent prompt must carry: task scope (what to do and NOT do), artifact
   references as ids/paths (not full content — the sub-agent fetches them itself), the
   rule-file paths to load first, and an instruction to record discoveries/decisions to the
   memory substrate before returning.

## Inline vs delegate — quick table

| Action                                            | Inline | Delegate             |
| ------------------------------------------------- | ------ | -------------------- |
| Read to decide/verify (1–3 files)                 | yes    | —                    |
| Read to explore/understand (4+ files)             | —      | yes                  |
| Read as preparation for writing                   | —      | yes (with the write) |
| Write atomic (one file, mechanical, known change) | yes    | —                    |
| Write with analysis (multiple files, new logic)   | —      | yes                  |
| Bash for state (git status, gh)                   | yes    | —                    |
| Bash for execution (test, build, install)         | —      | yes                  |

## Anti-patterns

- Reading 4+ files to "understand" inline → delegate exploration.
- Writing a feature across multiple files inline → delegate the write.
- Running tests/builds inline → delegate execution.
- Reading files as prep for edits, then editing inline → delegate both together.

## Fresh-context guarantee

A fresh-context sub-agent must NOT receive: full file contents readable from disk, prior
conversation summaries beyond what the task needs, or the orchestrator's accumulated inline
reads. Fresh means fresh.

## Notes

- Async delegation when work can proceed without blocking; sync only when the result is
  needed before the next action. Sub-agent results are not persisted automatically —
  summarize the handoff (in conversation or the memory substrate) before continuing.
- Parallel writers only with isolated worktrees + explicit approval; otherwise a single
  writer thread.

## Changelog

- v1 (2026-07-08, init): generated from the ChytaPay `delegation-harness` skill. Stripped
  ChytaPay-specifics (engram tool names, the SDD-orchestrator model-routing table,
  topic-key fetch); kept the generic delegation triggers, decision table, and
  fresh-context rules. No incident receipts yet — those accrue as the retro loop runs.
