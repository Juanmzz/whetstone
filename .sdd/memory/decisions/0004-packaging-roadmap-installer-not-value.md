---
id: adr-0004
ts: 2026-07-11
status: accepted
supersedes: null
amended_by: adr-0008      # partial waiver of the ordering rule — reasoning below still stands
rules_affected: []
---
# Packaging is an installer wrapper, not the value — Wizard-of-Oz first, CLI/plugin after

> **Amended by [[0008-engine-supersedes-woz]] (2026-08-07).** The ordering rule below is
> **discharged** for `init.md`/`retro.md` (Wizard-of-Oz'd and validated in the wild) and
> **explicitly waived** for the gate, check registry, triage, receipts and PR annotation, which
> are being built against a design rather than a validated procedure. The reasoning in this ADR
> is unchanged and still correct; only its applicability narrows.

## Context

While deciding whether to cut a publishable alpha, "should it be a CLI?" surfaced a
conflation of two layers that had been treated as one (ChytaPay ships them fused as a plugin):

- **The payload** — what governs the agent inside a target repo: `.sdd/` + emitted
  `CLAUDE.md`/`AGENTS.md` + skills + hooks. Vendor-neutral. This is the product's value.
- **The installer** — how the payload gets into a repo. Today: an agent-driven procedure
  (`init.md`, "read this and run the Whetstone init here"). Candidate future surfaces:
  `npx whetstone init`, a Claude Code plugin, hook emission.

Building a CLI now would package a payload not yet validated — the exact ordering error
recorded in `sig-0001` (build ahead of validation).

## Decision

- **The installer is a wrapper, not the value.** A polished CLI around miscalibrated skills is
  worthless. Effort goes to payload quality + the retro loop first.
- **Order is fixed: Wizard-of-Oz → validate by dogfooding → then wrap.** V0 alpha = `init.md`
  run by an agent. Only after a real dogfood run proves the payload do we build `npx whetstone
  init` and/or a Claude Code plugin, and emit vendor hooks (the SessionStart-injection pattern
  generalized from ChytaPay lives in the emitter layer, since hooks are per-vendor).
- **The payload must be self-contained — it travels to another repo.** Anything the target
  repo needs (e.g. the signal/ADR schema) is seeded into `.sdd/` at init; nothing may reach
  back to Whetstone's own `SPEC.md`. First concrete application: `init.md` writes
  `.sdd/memory/README.md` with the memory schema instead of cross-referencing SPEC.
- Memory backend stays pluggable per [[0001-memory-is-an-interface]]: `files` default,
  engram/others optional adapters behind `save`/`search`/`summarize`. "Plug into any" is
  already the architecture, not new work.

## Consequences

- No CLI, plugin, TUI, or automated retro in the alpha. `init.md` is the installer.
- The alpha (`v0.1.0-alpha`) is the self-contained payload + the runnable procedure, validated
  by USE on the pending company home-challenge, not by building more.
- A research pass on memory adapters (Basic Memory, mem0, Letta, native MCP memory servers) is
  parked: the question is whether the 3-method contract is broad enough to fit them, not which
  one to pick.
- Public release / npm / plugin packaging stay gated behind the dogfooding result, consistent
  with [[0003-positioning-human-gated-not-autonomous]]'s kill criterion.
