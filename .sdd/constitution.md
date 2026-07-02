# Constitution — Whetstone

> Hand-seeded pre-wizard. `whetstone init` will eventually generate this from a project
> interview; for now it is maintained by hand so the project can dogfood its own `.sdd/`.

## Purpose

A generic, self-improving workflow bootstrapper for coding agents. Whetstone owns the
feedback loop (use → record → distill → amend), not the forward workflow.

## Risk profile

Does **not** handle money, PII, or production data — it is developer tooling. The primary
risks are scope creep and coupling, not data loss. Triage discipline is therefore about
keeping the core small, not about financial correctness.

## Non-negotiables

1. **Files-first.** All state is plain text in git. The core must be fully functional with
   the file backend alone. No required servers or databases.
2. **Memory is an interface.** `save` / `search` / `summarize` is the only contract the core
   depends on. Never fork or hard-depend on a specific backend (engram included).
3. **Human-in-the-loop.** The retro proposes; a human disposes. No autonomous rule writes.
4. **Rules carry receipts.** Every rule cites the incidents/decisions that created it.
5. **Anti-scope is policy.** Not a spec framework, not a memory server (see VISION.md).

## Stack facts

TBD — to be decided during M1. Files-first design keeps the runtime choice open; the CLI
language and packaging are not yet committed.
