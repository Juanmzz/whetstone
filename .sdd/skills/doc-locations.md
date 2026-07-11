---
id: doc-locations
version: 1
status: active
---
# Documentation locations

Every `.md` the agent creates is either **team-shared** (belongs in the repo, versioned,
visible to the team) or **personal-local** (a draft on the dev's machine, not committed).
Decide explicitly — never leave docs in ambiguous places (home dir, `/tmp`, an app repo root).

## Rules

1. [DL1] Before creating any `.md`, classify it: team-shared or personal. If it doesn't
   clearly fit either, ASK — and default to personal when in doubt (promoting later is
   cheaper than unwinding an accidental team commit).
2. [DL2] When a personal draft matures, surface "promote to the team location?" → user
   confirms → move it (via `git mv` if tracked) and commit. Never auto-promote without
   confirmation.
3. [DL3] When the content doesn't match the decision table below, ask before creating.
   Default to personal. Common ambiguous cases: "save my notes" (likely personal), "document
   the convention we agreed" (likely team — an ADR or runbook), "write a retro" (could be
   either — ask).
4. [DL4] Artifact language follows the project's constitution, not this skill's chat language
   (see Language, below).
5. [DL5] Explicit user instruction wins over the decision table: "save this in my drafts" →
   personal; "this goes in the repo" → team.
6. [DL6] Don't reorganize a dev's personal-doc structure — create, rename, or move
   subfolders inside a personal-docs path — without explicit user instruction.

## Decision table — where to save

The exact paths are set by the project; this is the shape, not the addresses.

| Content type                                    | Nature                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| Product specs / PRDs                            | Team-shared                                       |
| Spec/design/task artifacts of a change          | Memory substrate or team-shared (project's call)  |
| Architecture docs, ADRs, roadmap, runbooks      | Team-shared                                       |
| Onboarding guides                               | Team-shared                                       |
| Per-repo agent config (`CLAUDE.md`/`AGENTS.md`) | Team-shared (per repo)                            |
| Personal drafts, ideas, brainstorms             | Personal                                          |
| Mid-draft spec before it's ready                | Personal → team once mature                       |
| Per-dev retro notes                             | Personal                                          |
| Session summary                                 | Memory substrate (not a file)                     |

## Language

Defaults when the project says nothing:

- code, identifiers, comments, paths, command names, agent-config `.md` → the codebase's
  primary language (usually English — it's read by the agent);
- human-facing runtime prose (PR descriptions, issue/ticket text, commit messages) → the
  project's human language;
- mixed audience in one file → split, never mix.

## Anti-patterns

- `.md` at an app repo root (only agent-config files belong there).
- Personal drafts committed to the team repo.
- Team-relevant docs left in a personal location without surfacing them for promotion.
- `unsorted/` or `misc/` folders anywhere.
- Saving session context as a `.md` instead of a session summary in the memory substrate.
- Reorganizing a personal-doc folder structure without asking first.

## Changelog

- v1 (2026-07-09, init): generated from the ChytaPay `doc-locations` skill. Stripped
  ChytaPay-specifics (hard-coded workspace/plans paths, agilpay repo names, Engram topic-key
  rows, the Spanish-product language mapping). Kept the team-vs-personal split, the
  decision-table shape, and the promotion/ambiguity/override rules plus anti-patterns.
  Generalized: artifact language is set by the project's constitution — this file no longer
  hard-codes Spanish/English — and Engram rows became "memory substrate"
  ([[0001-memory-is-an-interface]]). No signal receipts yet. Reformatted to SPEC §3.3:
  consolidated DL1–DL5 into a single `## Rules` list; restored a generalized version of the
  dropped ChytaPay rule against reorganizing personal-doc subfolders without asking (DL6).
