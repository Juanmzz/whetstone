---
id: init
version: 0
status: alpha
---
# Whetstone init

> **WoZ-era reference (ADR-0008).** Superseded as the installer; retained as the working
> specification for **Step 6** (`wst init`). This procedure was validated in the wild — it is the
> behaviour the code must reproduce.

Agent-driven bootstrap. Run this **from the target project's repo** with a coding agent
(Claude Code, Cursor, …). It reads the repo, asks only what it can't infer, generates a
self-contained `.sdd/`, and emits `CLAUDE.md` + `AGENTS.md`. Files backend by default — no
server, no database, no dependencies.

**Ceiling: ~15 minutes.** If you pass it, you're over-asking — infer more, ask less. The repo
answers most questions if you look.

**How to run:** from the target repo, tell the agent: *"Read `<path-to>/whetstone/init.md` and
run the Whetstone init here."* The agent follows the steps below and writes into the target repo
— never into Whetstone's own repo.

---

## 0. Preconditions (do this before writing anything)

1. **Confirm the working directory.** Print the cwd and the target repo name; ask the user to
   confirm this is where `.sdd/` should be created. Wrong-cwd is the classic bootstrap failure.
2. **Clean-room check.** If another always-on agent-config plugin is active (a company plugin,
   a global persona, a memory protocol), warn the user: it will inject competing rules and its
   own memory anchor. Recommend disabling it for this project's sessions so Whetstone's
   definition governs alone. Do not proceed silently over a conflict.
3. **Refuse to overwrite.** If `.sdd/` already exists, stop and ask — this is init, not re-init.

## 1. Read the repo — infer, don't ask

Detect and note **without asking the user**:

- language / stack, package manager, test runner (if any), CI, top-level layout;
- greenfield (empty or near-empty) vs brownfield (existing code);
- commit style, from `git log` if there is history.

Use `glob`/`grep` — do **not** read every file (token economy). If greenfield, say so and skip
stack inference; you'll set conventions from the interview instead.

## 2. Grilling session — ask ONLY what the repo couldn't answer

This is an interrogation, not a soft questionnaire (Pocock's "grill me"): push back on vague
answers, ask one at a time, and STOP after each until the human replies. The goal is a *shared
understanding* of the project before a single file is generated. **Skip any question the repo
already answered.**

1. **Purpose** — what is this project, in one or two sentences?
2. **Risk profile** — is there anything here where a bug is expensive: money, auth, personal
   data, data integrity, safety-critical logic? *(Take-home / demo → usually "no; the real risk
   is correctness and readability for a reviewer.")*
3. **Strict paths** — which parts, if any, must never ship without full TDD + review? This maps
   the risk profile to concrete paths/globs. *(Greenfield → often "the core domain logic, once
   it exists.")*
4. **Conventions / non-negotiables** — style, commit format, language of code and docs? Default
   if unstated: code + config in English; commit style inferred from `git log`.
5. **Working relationship** — how should the agent engage you? Default (`skills/voice.md`): a
   demanding senior collaborator — anti-pleaser, verifies before agreeing, pushes back at real
   forks. Calibrate only the dials: chat language, and how hard you want to be pushed.
6. **Backend** — `files` (default: self-contained, git-native, zero deps — recommended) or an
   external memory adapter? Default to `files` unless the user explicitly asks otherwise.

## 3. Generate `.sdd/` in the target repo

Write these. Fill every `{{placeholder}}` from steps 1–2; leave none unresolved.

### `.sdd/constitution.md`

```markdown
---
id: constitution
generated: {{date}}
status: active
---
# {{project-name}} — constitution

## Purpose
{{one or two sentences from the interview}}

## Risk profile
{{money / auth / PII / data-integrity / safety — or "none; primary risk is correctness and
reviewer legibility"}}

## Non-negotiables
{{bullets — e.g. "core logic ships with tests", "no secrets in the repo". For a low-risk
take-home this may be short.}}

## Stack facts
{{inferred in step 1 — language, runner, package manager. "greenfield" if empty.}}

## Conventions
{{code/docs language, commit format, style — inferred or from the interview}}
```

Amended only by explicit human edit. The retro never touches it.

### `.sdd/triage-rules.md`

```markdown
---
id: triage-rules
generated: {{date}}
status: active
---
# Triage rules

Classify every change into a discipline level BEFORE work starts.

| Level    | Applies to                                   | Discipline |
| -------- | -------------------------------------------- | ---------- |
| `strict` | {{strict paths from step 3, as globs/keywords}} | full TDD (RED→GREEN→TRIANGULATE→REFACTOR), fresh-context review, no shortcuts |
| `light`  | standard changes not matching strict         | failing happy-path test first |
| `off`    | trivial (docs, config, one-liners)           | no ceremony |

Default when a change matches nothing above: `light`.
```

This file **is** retro-amendable — `triage-miss` signals are its primary input.

### `.sdd/skills/`

Copy the eight skill files from Whetstone's `.sdd/skills/` **verbatim** into the target's `.sdd/skills/`:
`delegation.md`, `tdd-discipline.md`, `doc-locations.md`, `token-economy.md`, `recording.md`, `voice.md`, `lazy.md`, `xreview.md`.

Do **not** rewrite the skills per project. They are generic on purpose — the *constitution* and
*triage-rules* do the calibration (e.g. money → strict is expressed in triage-rules, not by
editing the TDD skill).

**Calibration — activate only what fits.** Not every project needs every skill. List the ACTIVE
skills in `wst.yaml`; the emitter references only those. Copy all eight files regardless (so a
skill can be switched on later without a re-init), but a skill the constitution makes irrelevant
runs at reduced scope or off. Example: a solo greenfield take-home has no team/personal split, so
`doc-locations` runs minimally (keep a decision trail, don't scatter `.md`) or is left inactive.
Deactivation is calibration, not deletion.

### `.sdd/memory/`

- `signals.jsonl` — create empty.
- `decisions/` — create the directory and copy `_TEMPLATE.md` (from Whetstone's
  `.sdd/memory/decisions/`) into it, so the first ADR is a fill-in, not a blank page. Seed a
  real `0001-*.md` too if a decision was already made during init (e.g. a stack choice).
- `patterns.md` — create with a one-line header.
- `retro-log.md` — create with a one-line header.
- `README.md` — **the memory schema travels with the payload** (Whetstone's own `SPEC.md`
  does NOT get copied). Write it verbatim so the target repo is self-contained and any agent
  knows how to log without reaching back to Whetstone:

```markdown
# Memory — how to log

## `signals.jsonl` — append-only, one JSON object per line

A signal is a moment the agent went off-track and got corrected, or a near-miss — raw fuel
for the retro. Log the small ones too; that is the point.

| field | req | notes |
|-------|-----|-------|
| `id` | yes | `sig-` + zero-padded counter, e.g. `sig-0001` |
| `ts` | yes | ISO 8601 datetime |
| `type` | yes | kebab-case, open vocab: `wrong-cwd`, `triage-miss`, `test-skip`, `scope-creep`, `context-blowout`, ... |
| `phase` | yes | `init` \| `triage` \| `plan` \| `apply` \| `verify` \| `review` \| `other` |
| `severity` | yes | `low` \| `medium` \| `high` |
| `detail` | yes | one or two sentences a human can reconstruct from |
| `rule_affected` | no | skill file(s) implicated, e.g. `["skills/delegation.md"]` |
| `supersedes` | no | id of an earlier entry this one corrects |
| `resolved_by` | no | filled by the retro: amendment id that addressed it |

Corrections are NEW entries with `supersedes` — never edit or delete a line.

## `decisions/` — one ADR markdown file per decision (`0001-slug.md`)

Front-matter: `id`, `ts`, `status` (proposed | accepted | superseded), `supersedes`,
`rules_affected`. Body: Context, Decision, Consequences. Signals are data for the loop;
decisions are prose for humans. Both feed the retro; the write is always human-gated.
```

### `.sdd/wst.yaml`

```yaml
version: 0
backend: files
retro:
  suggest_after: 5
skills:                       # ACTIVE skills only; the emitter references these
  - skills/delegation.md
  - skills/tdd-discipline.md
  - skills/token-economy.md
  - skills/recording.md
  - skills/voice.md
  - skills/lazy.md
  - skills/xreview.md
  # - skills/doc-locations.md   # inactive for a solo project; enable if a team/docs tree grows
```

## 4. Emit vendor config (ADR-0002)

Emit TWO files at the target repo root, both derived from `.sdd/` — but NOT duplicated.
`AGENTS.md` is the canonical, cross-vendor standard (Cursor, Zed, Aider, Codex read it directly).
`CLAUDE.md` is a one-line import of it, because Claude Code reads ONLY `CLAUDE.md` and honors the
native `@path` import — one source of truth, zero duplication ([[token-economy]] T1).

**`AGENTS.md`** (canonical) — a deterministic stitch of `.sdd/`, no cleverness:

```markdown
# {{project-name}} — agent workflow (generated by Whetstone; do not edit by hand)

Source of truth is `.sdd/`. Regenerate this file from it; never edit it directly.

## Constitution
{{inline the constitution's Purpose, Risk profile, Non-negotiables, Conventions}}

## How changes are triaged
{{inline the triage-rules table}}

## Active skills (read the file before acting when its trigger matches)
{{list only the skills marked active in wst.yaml — example for a solo project:}}
- `.sdd/skills/delegation.md` — inline vs delegate to a fresh-context sub-agent
- `.sdd/skills/tdd-discipline.md` — strict/light/off test rigor per triage
- `.sdd/skills/token-economy.md` — keep context lean
- `.sdd/skills/recording.md` — what to save to memory, when; human-gated
- `.sdd/skills/voice.md` — how the agent engages you: anti-pleaser, verify-before-agree
- `.sdd/skills/lazy.md` — minimal-first: does this need to exist? reuse before adding
- `.sdd/skills/xreview.md` — adversarial fresh-context review on high-stakes changes

## Recording what happens
- Something goes wrong → append an entry to `.sdd/memory/signals.jsonl` (schema in
  `.sdd/memory/README.md`).
- A decision is made → add an ADR to `.sdd/memory/decisions/`.
- Periodically → run the retro (see `retro.md`): read the new signals, recommend apparatus
  (amend a rule, curate/generate a skill/hook/command), human confirms each write. (Alpha =
  the `retro.md` playbook run by hand; the write stays human-gated either way.)
```

**`CLAUDE.md`** — NOT a copy. A one-line import so Claude Code reads the same canonical source:

```markdown
@AGENTS.md
```

Add Claude-specific lines below the import only if the project needs them (Claude Code reads
only `CLAUDE.md`; the `@path` import is expanded inline at session start). Both files are
OUTPUTS — `.sdd/` is never derived from them.

## 4b. Emit the code tier — hooks (V1, per-vendor)

The markdown tier above is advisory. The **code tier** is enforcement, and it is
vendor-specific (ADR-0005): compile `.sdd/` into the target tool's native mechanism. For
**Claude Code**, that is `.claude/settings.json` + `.claude/hooks/*`. Other vendors get what
they natively support, or nothing — degrade gracefully.

**First hook — `strict-path-guard` (compiled from `triage-rules.md`).** Read the `strict` row's
paths/globs and bake them into a PreToolUse hook so an edit to a strict-tier path surfaces a
non-blocking warning. The globs are THIS project's (e.g. `src/sync/**` for a sync engine), not a
fixed list — that is the compiler at work.

- `.claude/hooks/strict-path-guard.mjs` — reads `tool_input.file_path` from stdin, matches it
  against the compiled strict prefixes, and on a hit emits
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"defer","additionalContext":"⚠ strict-tier edit …"}}`
  then `exit 0`. `defer` = allow + inject the warning; it never blocks. Needs a `#!/usr/bin/env node`
  shebang and the executable bit. (Reference implementation: Whetstone's own `.claude/hooks/`.)
- `.claude/settings.json` — wire it: `hooks.PreToolUse` with `matcher: "Edit|Write"` →
  `command: "$CLAUDE_PROJECT_DIR/.claude/hooks/strict-path-guard.mjs"`.

The hook is GENERATED output — mark it "do not edit by hand; regenerate after changing
`triage-rules.md`." Ship ONLY this one at init. Further hooks (config-protection, session
context re-inject, recording nudge, block-no-verify) are **earned per-project via the retro**
when signals prove a rule is being ignored — never sprayed up front (ADR-0005, [[token-economy]]).

## 5. Confirm + commit

Show the user a tree of everything created. Offer to stage and commit:
`git add .sdd .claude AGENTS.md CLAUDE.md` → `chore: bootstrap Whetstone workflow`. Never commit
without confirmation.

## 6. Optional — integrate an external memory backend (engram)

Only if the user asks. Files remain the source of truth; the adapter is a regenerable cache.

1. Confirm the backend MCP is available and enabled **independently** of any company plugin — if
   it ships as another plugin's dependency, enabling it must not re-activate that plugin's rules.
2. **Namespace it to THIS project.** Every memory call uses a dedicated key derived from the repo
   name (e.g. `project: "{{repo-name}}"`). NEVER reuse another project's key — that is the exact
   cross-contamination this step exists to prevent.
3. Set `backend: engram` (and record the namespace key) in `.sdd/wst.yaml`.
4. The three-method contract is unchanged: `save` / `search` / `summarize` (SPEC §2.3). If the
   adapter is ever removed, the file substrate still holds everything.

## Changelog

- v0 (2026-07-11, draft): first agent-driven init procedure. Files-first, clean-room by default,
  engram as an optional namespaced step. Wizard-of-Oz — no code tool yet; the procedure IS the
  installer. Validated by dogfooding on a real greenfield project before hardening.
