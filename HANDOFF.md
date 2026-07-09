# Whetstone — Session Handoff (2026-07-09)

Narrative recap of the session that took Whetstone from a design brief to a scaffolded,
self-dogfooding repo. Read alongside `CLAUDE.md` (durable agent orientation) and the ADRs
in `.sdd/memory/decisions/` (full decision context). **This file captures the reasoning and
the arc — the "why", not just the "what".**

## The arc

1. Started in the ChytaPay workspace — fixed a plugin version bug (`marketplace.json` said
   0.2.1 but `plugin.json` said 0.2.0; the plugin manifest is the source of truth, so the
   updater saw "already latest").
2. Pivoted to **Whetstone**: generalize ChytaPay's `chyta:*` workflow system into a generic,
   git-native, self-improving workflow bootstrapper for coding agents.
3. Materialized the repo from the design brief, recorded decisions as ADRs, genericized the
   first skill, and produced this handoff.

## What Whetstone is

A generic, files-first bootstrapper that owns the **feedback loop** (use → record → distill →
amend), not the forward workflow. Two parts: a 15-min agent-driven init that generates a
`.sdd/` config, and a retro loop that proposes human-gated amendments to workflow rules with
an audit trail. Composes with Spec Kit / BMAD / Superpowers; not a memory server.

## Decisions made — with reasoning

- **ADR-0001 — Memory is an interface.** Why: dodge the scope trap of building our own
  engram. Files + grep is enough to feed the loop; adapters (engram/sqlite) swap behind
  `save`/`search`/`summarize` without touching the core. Embeddings deferred.
- **ADR-0002 — Config emission is a pluggable renderer.** Why: no single native config file
  across CLIs. `.sdd/` is the vendor-neutral source of truth; emitters render it. Write
  `CLAUDE.md` + `AGENTS.md` (AGENTS.md now native in 28+ tools). Generalizes ChytaPay's
  `bootstrap.mjs`.
- **ADR-0003 — Human-gated, not autonomous.** Why: prior-art check confirmed novelty (no
  exact match; closest is Cursor Bugbot, but autonomous / Cursor-locked / UI-managed / no
  receipts). The human gate + incident receipts are the moat vs Bugbot, DSPy, and the
  "do-it-manually" blog advice. Value is unproven → validated by dogfooding, not by the
  market gap. **Kill criterion pre-registered.**

### Strategic decisions (not yet ADRs — fold in if they harden)

- **Option B: init-first.** V0 = the 15-min init (the hook). Loop = V1 (the moat). The
  init's payload must be RICHER than commodity rule-generators (Orbit, cursorrules) — it
  installs a disciplined methodology, not just a rules file.
- **No TUI.** Agent-driven init reads the repo and asks only what it can't infer. The 15-min
  ceiling reinforces this — a form would blow the budget.
- **Retro is automatic in analysis/proposal, human-gated on the write.** Automatic where it's
  tedious, human where the blast-radius is high (a bad auto-applied rule degrades every
  future session silently).
- **Validate the loop BY HAND before building V1.** Wizard-of-Oz it on a real project first;
  automate only if the manual retro produces value. See `inc-0001`.
- **Private-first.** Public / npm / issues gated behind the dogfooding result. Private remote
  ≠ publishing.
- **Self-hosting is layered.** Whetstone-on-Whetstone (level 1, always-on) proves the
  substrate but NOT genericity, and generates design incidents rather than the rich workflow
  incidents the loop needs. A DIFFERENT real project (level 2) is still required for the real
  validation. (Self-hosting-compiler analogy: compiling its own source ≠ compiling all
  programs.)

## Prior-art verdict

GO on novelty. Positioning lines vs "this already exists":
- vs **Bugbot** → human-gated, cross-tool, git-native, with rule→incident receipts.
- vs **doing it manually** → the distillation layer that detects patterns and proposes diffs,
  and leaves a paper trail.
- vs **DSPy** → readable rules, human gate, incident-sourced (DSPy is autonomous, metric-driven,
  rewrites prompts no human reads).

## Open threads (decide next)

- **Refinement to fold in:** the loop should learn from **session work**, not only hand-logged
  incidents — touches `OPEN_QUESTIONS.md` #4 (where the signal comes from).
- The 4 items in `OPEN_QUESTIONS.md` (incident type vocab; are decisions retro-amendable;
  multi-agent JSONL writes; init interview format).
- **Which real project to dogfood** (the level-2 validation target) — not chosen yet.

## Guardrails — the instructions, do NOT drop these

1. Init-first (Option B). Don't start with the loop.
2. Validate by hand before building V1. Build follows validation, never the reverse (`inc-0001`).
3. **Anti-drift:** everything generic must be a STRIP of something already earning its keep in
   ChytaPay. If it's not in the workspace, don't invent it.
4. Don't build our own memory engine (ADR-0001). Files + grep for M1.
5. Keep V0 brutal. (Owner's own flagged risk: starting projects before shipping the queued
   ones. Ship the known pain first.)
6. Public release gated behind the dogfooding kill criterion (ADR-0003).

## Current status + next step

- Scaffold committed locally (branch `main`, no remote yet). ADR-0001..0003 recorded,
  `inc-0001` logged, `skills/delegation.md` at v1 (the exemplar).
- **NEXT — finish Brick 2:** genericize the remaining three skills (`tdd-discipline`,
  `doc-locations`, `token-economy`) following the `delegation.md` pattern. Source paths and
  the money/cents caveat are in `CLAUDE.md` → "Next step".

## Repo facts

- Local at `~/Documents/whetstone`, branch `main`, **no remote yet**.
- `gh` set to the personal account for the eventual **private** push.
- Commits authored as `jmjuanmz@gmail.com`.
