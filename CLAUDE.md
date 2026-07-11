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

## Current status

- Repo scaffolded and committed locally (branch `main`, no remote yet — GitHub is gated behind
  dogfooding). VISION / README / SPEC / LICENSE / OPEN_QUESTIONS in place.
- `.sdd/` substrate live; ADR-0001..0004 recorded; `sig-0001` logged.
- **Brick 2 DONE.** Six skills genericized to v1 (`status: active`) in `.sdd/skills/`:
  `delegation`, `tdd-discipline`, `doc-locations`, `token-economy`, `recording` (the
  what/when/who-confirms of memory writes), and `voice` (how the agent engages the human —
  anti-pleaser, verify-before-agree; from ChytaPay `01-persona` + Gentleman). Pattern held:
  STRIP ChytaPay-specifics / KEEP generic rule structure / ADD front-matter + rule IDs +
  `## Changelog`. ChytaPay mentions survive ONLY in each changelog as provenance. Receipts are
  earned by real signals, never seeded at init.
- **`init.md` (root) — alpha, v0.** The agent-driven Wizard-of-Oz bootstrap: 6 phases
  (preconditions → read repo → grill → generate `.sdd/` → emit `CLAUDE.md`/`AGENTS.md` →
  commit), all templates filled. The procedure IS the installer (no code tool yet, per
  `sig-0001`). This is the V0 hook.

## Next step (resume here)

**DOGFOOD.** The alpha payload is complete — validate it by USE, not by building more. Take
`init.md` to a real greenfield project (the pending company home-challenge) and run it there:
from that repo, tell the agent *"read `<path>/whetstone/init.md` and run the Whetstone init
here."* Accumulate real signals in that project's `.sdd/memory/signals.jsonl`, run the retro
BY HAND, and only then decide what V1 automates. Build follows validation, never the reverse
(`sig-0001`).

Do NOT: build the retro loop in code, add a TUI, or polish `init.md` further in the abstract
before a real run surfaces the gaps.
