---
id: adr-0005
ts: 2026-07-13
status: accepted
supersedes: null
rules_affected: []
---
# The emitter is a compiler; the code tier (hooks/agents/commands) is the V1 scope

## Context

This session settled what Whetstone's OUTPUT should ultimately be: not a rules file, but the
full per-project apparatus — the class of artifacts a mature hand-built workspace has (mapped
against ChytaPay's `plugin/` tree: `context/`, `skills/`, `agents/`, `hooks/`, `commands/`,
`templates/`). The open question was how a generic, cross-vendor tool produces that without
becoming vendor-locked like ChytaPay (which ships AS a Claude Code plugin).

Two tiers of artifact exist, with opposite vendor stances:
- **Markdown tier** — constitution, triage-rules, skills, memory. Vendor-NEUTRAL. Produced today (V0).
- **Code tier** — sub-agents, hooks, commands, permissions. Vendor-SPECIFIC (Claude Code hooks
  ≠ Cursor; most tools have no equivalent). Not produced yet.

## Decision

- **The emitter is a COMPILER.** `.sdd/` is the single vendor-neutral source; each vendor's
  emitter compiles it into that tool's native apparatus. Generalizes ADR-0002 from "renderer"
  to "compiler with a code tier."
- **Cross-vendor is FULL at the markdown tier, PARTIAL at the code tier.** Each vendor gets the
  richest apparatus it can natively express; the emitter degrades gracefully where a tool has no
  equivalent (e.g. Cursor gets no hooks). The neutral `.sdd/` is the durable asset.
- **The code tier is the V1 scope. Claude Code is the first code-tier emitter target** (richest
  apparatus: hooks, agents, commands, plugin packaging).
- **Code-tier artifacts are EARNED per-project (retro-driven), not sprayed at init** — a rule the
  signal log proves is ignored graduates from advisory (skill) to enforced (hook). Blanket
  spraying would cargo-cult ChytaPay's shape without its earned knowledge ([[sig-0001]], `chyta-lazy`).
- **Distribution: CLI first (cross-vendor).** A Claude Code plugin is an OPTIONAL convenience
  wrapper, never the identity — building Whetstone AS a plugin would vendor-lock the tool itself
  and betray the whole thesis.

## Consequences

- V1's concrete engineering = the Claude Code code-tier emitter (compile `.sdd/` → `.claude/`
  hooks/agents/commands). The "intelligence" is derivation from the project's own definitions
  (triage strict-paths → a guard hook; a non-negotiable → a block hook), not a fixed pack.
- Validated by dogfooding on Whetstone's OWN `.sdd/` before applying to any real project — WoZ a
  hook from Whetstone-self first, then codify (respects [[sig-0001]]).
- Reversal condition: if the neutral-source → per-vendor-compile model proves unworkable at the
  code tier (the derivation is too tool-specific to generalize), reconsider shipping Whetstone as
  a plain Claude Code plugin and accepting vendor-lock — but only after the WoZ proves it, not before.

## Amendment (2026-07-14) — foundational vs graduated hooks

The crossed review (adversarial judges + cloud) flagged a contradiction: `init.md` §4b emits a
hook AT INIT, while "earned per-project via the retro, not sprayed" (above) reads as forbidding
any hook before a signal. Resolution — distinguish two classes of code-tier artifact:

- **Foundational** — derivable purely from the constitution / `triage-rules.md` a project just
  authored (e.g. `strict-path-guard`, which compiles the strict paths the human already declared).
  These MAY ship at init: they encode a decision the human made moments ago, not a guess, and the
  reference guard is non-blocking. This is the compiler applied to the init-time definitions.
- **Graduated** — earned when the signal log proves an advisory rule is repeatedly ignored (retro
  step 3, "graduate advisory → enforced"). These are NEVER sprayed at init.

"Not sprayed at init" governs *graduated* hooks. Shipping a foundational guard derived from the
project's own triage is compilation of an existing decision, not cargo-culting. `init.md` §4b
ships exactly one foundational hook; everything else is graduated.
