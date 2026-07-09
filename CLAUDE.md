# Whetstone — agent orientation

> Hand-seeded pre-wizard (like `.sdd/constitution.md`). Eventually `whetstone init` generates
> the agent-config file(s); for now this is maintained by hand so the project dogfoods itself.

Whetstone is a generic, git-native, files-first bootstrapper for coding agents. It owns the
**feedback loop** (use → record → distill → amend), not the forward workflow.

## Read first

1. `VISION.md` — thesis, what it is / is NOT, milestones.
2. `SPEC.md` — the real contract: `.sdd/` layout, incident/ADR/skill schemas, retro algorithm.
3. `.sdd/memory/decisions/` — the ADRs below, in full.

## Where things live

- `.sdd/constitution.md` — project governance (hand-seeded).
- `.sdd/wst.yaml` — config (backend: files; skills registry).
- `.sdd/memory/incidents.jsonl` — append-only incident log. `inc-0001` is the first real datum.
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
  incident receipts + git-native + cross-tool. No autonomous rule rewriting. Novelty is
  confirmed (prior-art check: no exact match; closest is Cursor Bugbot, but autonomous/closed).
  **Value is unproven — validated by dogfooding, not by the market gap.** Kill criterion is
  pre-registered in the ADR.

## Product shape (settled this session)

- **Option B: init-first.** V0 = the 15-min agent-driven init (the hook). The retro loop = V1
  (the moat). The init's payload must be RICHER than commodity rule-generators (Orbit,
  cursorrules) — it installs a disciplined methodology, not just a rules file.
- **No TUI.** The init is agent-driven: it reads the repo and asks only what it can't infer.
  The 15-min ceiling reinforces this — a form would blow the budget.
- **The retro is automatic in analysis/proposal, human-gated on the write.** Automatic where
  it's tedious, human where the blast-radius is high.
- **Validate the loop BY HAND before building V1.** Wizard-of-Oz: use the tool on a real
  project, accumulate incidents, run the retro manually, and only automate if it produces
  value. Build follows validation, never the reverse (see `inc-0001`).

## Current status

- Repo scaffolded and committed locally (branch `main`, no remote yet — GitHub is gated behind
  dogfooding). VISION / README / SPEC / LICENSE / OPEN_QUESTIONS in place.
- `.sdd/` substrate live; ADR-0001..0003 recorded; `inc-0001` logged.
- **Brick 2 in progress:** `skills/delegation.md` genericized to v1 (the exemplar). Pattern =
  STRIP ChytaPay-specifics (engram tool names, orchestrator routing, topic keys) / KEEP the
  generic rule structure / ADD front-matter + `[Dn]` rule IDs + `## Changelog`. Receipts are
  earned by real incidents, never seeded at init.

## Next step (resume here)

Finish **Brick 2** — genericize the remaining three skills into `.sdd/skills/`, following the
`delegation.md` pattern exactly:

- `tdd-discipline.md` ← source `~/Documents/ChytaPay/chytapay-workspace/plugin/skills/chyta-tdd-discipline/SKILL.md`
  (KEY: money/cents rules must become an EXAMPLE of a `strict` path defined by the project's
  constitution — NOT a hard-coded core rule.)
- `doc-locations.md` ← source `~/Documents/ChytaPay/chytapay-workspace/plugin/skills/chyta-doc-locations/SKILL.md`
- `token-economy.md` ← source `~/Documents/ChytaPay/chytapay-workspace/plugin/skills/chyta-token-economy/SKILL.md`

Those source files live in the ChytaPay repo (a different project) but are readable by absolute
path on this machine. After the four skills exist, the payload is complete — then pick a real
project to dogfood, or build the minimal init. Do NOT jump to building the retro loop first.
