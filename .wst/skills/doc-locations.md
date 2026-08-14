---
id: doc-locations
version: 3
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

7. [DL7] **Prose that describes the tool's own behaviour is part of the change that alters
   it.** Deleting a subsystem, renaming a command, or switching a mode is not finished until
   the documents describing it are updated in the same change — and prose calibrated for one
   mode is never reused for another. A doc that survives the thing it describes is a false
   claim with a long half-life.
   - **Comments follow the same rule, and one more: a comment names evidence or points at a
     decision, and never re-argues one.** The argument belongs in the ADR, where it is
     versioned and signed; repeating it beside the code is one rule living in two places.

8. [DL8] **The code explains itself; comment only what it cannot.** The first move when a
   line needs explaining is to remove the need — name the thing, split the function, delete
   the branch. A comment that restates what the code does is a second copy of it that no
   test keeps honest, and it drifts silently the first time the code changes. What survives
   that test is what the code genuinely cannot carry: why this and not the obvious
   alternative, which measurement chose a constant, which external contract forces the
   shape. [DL7] governs what such a comment may then contain — evidence, or a pointer at a
   decision, never a re-argued one; this rule is the step before it. Judgment, not a check:
   a script can count comment lines (`sig-672d598d` counted 4,391) and cannot tell a
   necessary one from a restatement.

## Changelog

- v3 (2026-08-14, owner decision): added [DL8] — make the comment unnecessary before
  writing it; comment only what the code cannot carry. It complements [DL7] rather than
  repeating it: DL7 constrains what a comment may say, DL8 asks first whether it should
  exist. Homed here because retro-0049 already moved the comment discipline into this file
  (`voice.md` governs reply text and says so), and one more rule beside DL7 is cheaper to
  read than a ninth skill file. Judgment, not machine-checkable.
- v2 (2026-08-14, retro-0049): added [DL7] — prose describing the tool's own behaviour is
  part of the change that alters it, and a comment names evidence or points at a decision
  rather than re-arguing one. From `sig-672d598d` (4,391 comment lines against 12,448 of
  code, 37 blocks over 15 lines) and from `README.md` describing a plan gate that did not
  exist for four days after the command that would have carried it was removed.
  **Retro-0049 proposed this against `voice.md` and the human moved it here**: `voice.md`
  governs reply text only and says so, which the retro itself noticed while drafting.

- v1 (2026-07-09, init): generated from the ChytaPay `doc-locations` skill. Stripped
  ChytaPay-specifics (hard-coded workspace/plans paths, agilpay repo names, Engram topic-key
  rows, the Spanish-product language mapping). Kept the team-vs-personal split, the
  decision-table shape, and the promotion/ambiguity/override rules plus anti-patterns.
  Generalized: artifact language is set by the project's constitution — this file no longer
  hard-codes Spanish/English — and Engram rows became "memory substrate"
  (`adr-0001`). No signal receipts yet. Reformatted to SPEC §3.3:
  consolidated DL1–DL5 into a single `## Rules` list; restored a generalized version of the
  dropped ChytaPay rule against reorganizing personal-doc subfolders without asking (DL6).
