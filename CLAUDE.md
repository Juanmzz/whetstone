# Whetstone — agent orientation

> Hand-seeded pre-wizard (like `.sdd/constitution.md`). Eventually `whetstone init` generates
> the agent-config file(s); for now this is maintained by hand so the project dogfoods itself.

Whetstone is a generic, git-native, files-first bootstrapper for coding agents. It owns the
**feedback loop** (use → record → distill → amend), not the forward workflow.

## Read first

1. `VISION.md` — thesis, what it is / is NOT, milestones.
2. `SPEC.md` — the real contract: `.sdd/` layout, signal/ADR/skill schemas, retro algorithm.
3. `.sdd/memory/decisions/` — the ADRs below, in full.

## Where things live

- `.sdd/constitution.md` — project governance (hand-seeded).
- `.sdd/wst.yaml` — config (backend: files; skills registry).
- `.sdd/memory/signals.jsonl` — append-only signal log. `sig-0001` is the first real datum.
- `.sdd/memory/decisions/` — ADRs, one file each.
- `.sdd/skills/` — versioned workflow rules (the payload the init installs).

## Decisions locked (ADRs — read the files for full context)

- **ADR-0001 — Memory is an interface.** File backend is the default + source of truth; the
  core depends only on `save`/`search`/`summarize`; engram/sqlite are optional adapters.
  M1 memory = files + grep. Do NOT build our own memory engine.
- **ADR-0002 — Config emission is a pluggable renderer.** `.sdd/` is the vendor-neutral source
  of truth; emitters render it. V0 default writes `CLAUDE.md` + `AGENTS.md` (AGENTS.md is now
  native in 28+ tools). Generalizes ChytaPay's `bootstrap.mjs`.
- **ADR-0003 — Human-gated, not autonomous.** Lead positioning with human-gated proposals +
  signal receipts + git-native + cross-tool. No autonomous rule rewriting. Novelty is
  confirmed (prior-art check: no exact match; closest is Cursor Bugbot, but autonomous/closed).
  **Value is unproven — validated by dogfooding, not by the market gap.** Kill criterion is
  pre-registered in the ADR.
- **ADR-0004 — Packaging is an installer wrapper, not the value.** Two layers: the *payload*
  (`.sdd/` + emitted config + skills + hooks) is the value; the *installer* (`init.md` now,
  `npx`/plugin later) is a wrapper. Order fixed: Wizard-of-Oz → validate → then wrap. Payload
  must be self-contained (it travels to another repo; nothing reaches back to Whetstone's SPEC).

## Product shape (settled this session)

- **Option B: init-first.** V0 = the 15-min agent-driven init (the hook). The retro loop = V1
  (the moat). The init's payload must be RICHER than commodity rule-generators (Orbit,
  cursorrules) — it installs a disciplined methodology, not just a rules file.
- **No TUI.** The init is agent-driven: it reads the repo and asks only what it can't infer.
  The 15-min ceiling reinforces this — a form would blow the budget.
- **The retro is automatic in analysis/proposal, human-gated on the write.** Automatic where
  it's tedious, human where the blast-radius is high.
- **Validate the loop BY HAND before building V1.** Wizard-of-Oz: use the tool on a real
  project, accumulate signals, run the retro manually, and only automate if it produces
  value. Build follows validation, never the reverse (see `sig-0001`).

## Current status — v0.2.0-alpha

- `.sdd/` substrate live; **ADR-0001..0006** recorded; **2 signals** logged. Tags:
  `v0.1.0` (payload) → `v0.1.1` (voice + memory contract) → `v0.2.0` (code-tier emitter).
- **6 skills** (`status: active`): `delegation`, `tdd-discipline` (**v2 — has TD6, the first
  earned receipt**), `doc-locations`, `token-economy`, `recording`, `voice`.
- **`init.md`** — the Wizard-of-Oz bootstrap: 6 phases + **4b (code tier)**. AGENTS.md is
  canonical, CLAUDE.md is a `@AGENTS.md` import (not duplicated). The procedure IS the installer.
- **Code tier started (V1):** `.claude/hooks/strict-path-guard.mjs` — the first emitter output,
  a PreToolUse hook whose strict globs are compiled from `triage-rules.md`. Validated WoZ.
- **THE LOOP IS VALIDATED IN THE WILD.** Dogfooded on the Two Way Invoice Sync take-home: init
  produced a strong `.sdd/`, the clean-room check caught a global-config conflict, ~9 real
  signals accumulated, and its **Retro 0002 produced TD6** — a genuinely good rule, contributed
  upstream here as `tdd-discipline` v2. That was ADR-0003's kill-criterion test, and it passed.

## Key decisions this phase

- **ADR-0005** — the emitter is a COMPILER (`.sdd/` neutral → per-vendor apparatus). Code tier
  (hooks/agents/commands) = V1 scope; earned per-project via the retro, not sprayed.
- **ADR-0006** — update model: copy + 3-way merge against a recorded base (`vendored_from` in
  `wst.yaml`) via `git merge-file`. Two tiers: skills merge, emitter output recompiles. retro /
  update / contribution are the same machinery in three directions.
- **The function, sharpened:** Whetstone RECOMMENDS the apparatus (skills/hooks/commands) a
  project needs, from real usage — curating an existing one when it fits, generating a
  project-specific one when it doesn't.

## Next step (resume here)

The Two Way Invoice Sync take-home is delivering (P10 deliverables) — leave its config as-is;
do not churn it mid-delivery. After it ships, it is the **test case for the updater**:

1. **`retro.md`** — write the retro as a Wizard-of-Oz playbook (like `init.md`). The loop ran
   ad-hoc; it needs a repeatable procedure. Highest-value, cheapest next step — it IS the function.
2. **Implement the updater** (ADR-0006): `vendored_from` + 3-way merge; run it on the challenge
   to pull the v0.2 hook and reconcile its local TD6 vs the canonical one. Validates ADR-0006 for real.
3. Curate the candidate library (`lazy`, `xreview` from ChytaPay) — existing proven skills, don't
   reinvent. Generate only the project-specific (hooks/commands).

Do NOT: build a CLI/plugin or distribution before the retro is repeatable; the moat is N=1, make
it N>1 first.
