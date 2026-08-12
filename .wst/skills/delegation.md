---
id: delegation
version: 3
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
4. [D4] On any signal (wrong cwd, accidental mutation, merge recovery, env workaround),
   stop, run a fresh audit, then continue.
5. [D5] After roughly 20 tool calls / 5 exploratory reads / 2 non-mechanical edits without
   delegation, pause and delegate.
6. [D6] Use fresh context for adversarial review of diffs, conflicts, and PR readiness — the
   value is independent judgment, not token saving.
7. [D7] Every sub-agent prompt must carry: task scope (what to do and NOT do), artifact
   references as ids/paths (not full content — the sub-agent fetches them itself), the
   rule-file paths to load first, and an instruction to record discoveries/decisions to the
   memory substrate before returning.
   - **Paths only work for a delegate that HAS tools.** The rule above assumes the sub-agent
     can fetch what you point at. A HERMETIC delegate — no filesystem, no tools, which is the
     right shape for a judge, since a repo must not be able to instruct its own reviewer —
     cannot resolve a path at all. For one of those, everything it must judge has to be INLINED
     as full content. Handing a hermetic judge a path is handing it nothing, and it will answer
     anyway: confidently, about a file it never saw.
8. [D8] **Verify a delegate's work against the base you dispatched from.** Capture the base
   commit BEFORE dispatch and check the range `base..HEAD`. Checking the working tree against
   HEAD is the trap: a delegate that commits leaves a clean tree, so the diff is empty and the
   verification silently covers nothing.
   - **Refuse an empty result.** A delegate that committed nothing has produced nothing to
     verify. Say so; do not run checks over an empty range and read the outcome as success.
   - **"No checks ran" must never share a message with "all checks passed."** They are
     different outcomes and only one of them is evidence. Collapsing them is how unverified
     work gets reported as verified.

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

- v3 (2026-08-08, retro-0025): [D7] gains the hermetic-delegate case. D7 said to pass
  artifact references as paths rather than content, because the sub-agent fetches them
  itself. That silently assumes the delegate HAS tools. A hermetic delegate — no
  filesystem, which is the correct shape for a judge, since a repo must not be able to
  instruct its own reviewer — cannot resolve a path, so everything it must judge has to be
  inlined. From sig-0017: the first `wst retro` returned three of four proposals as the
  literal word "placeholder", one explaining it had no visibility into the skill it was
  asked to amend. The existing rule was the cause, not an innocent bystander.
  **Contribution candidate.**
- v2 (2026-08-08, retro-0016): added [D8] — verify a delegate's work against the base
  captured BEFORE dispatch (`base..HEAD`), refuse an empty result, and never let "no checks
  ran" share a message with "all checks passed". From sig-0015: a dispatch-then-gate flow
  checked the working tree against HEAD, but the delegate had committed, so the diff was empty
  — the gate honestly reported that nothing was verified while the run printed PASSED above it.
  **Contribution candidate.**
- v1 (2026-07-08, init): generated from the ChytaPay `delegation-harness` skill. Stripped
  ChytaPay-specifics (engram tool names, the SDD-orchestrator model-routing table,
  topic-key fetch); kept the generic delegation triggers, decision table, and
  fresh-context rules. No signal receipts yet — those accrue as the retro loop runs.
