# Constitution — Whetstone

> Hand-seeded pre-wizard. `wst init` will eventually generate this from a project interview; for now
> it is maintained by hand so the project can dogfood its own `.sdd/`.

## Purpose

A self-sharpening standards layer for AI coding agents, installed per project and versioned as plain
files in git. It captures a project's definition of *correct* — its constitution, its risk triage,
and the checks that matter — and enforces it with a deterministic engine that calls an LLM only where
judgment is irreducible. It owns the definition-and-verification layer, plus the feedback loop that
sharpens it (use → record → distill → amend).

## Risk profile

Does **not** handle money, PII, or production data — it is developer tooling. The primary
risks are scope creep and coupling, not data loss. Triage discipline is therefore about
keeping the core small, not about financial correctness.

> Amended 2026-08-07 (ADR-0008): one risk now outranks scope creep. Whetstone **gates other
> people's work**. A wrong verdict either blocks legitimate changes or waves through broken ones,
> and a gate that does either stops being trusted — which is fatal, because a routed-around gate has
> negative value. Non-negotiables 6 and 7 exist for that reason.

## Non-negotiables

1. **Files-first.** All state is plain text in git. The core must be fully functional with
   the file backend alone. No required servers or databases.
2. **Memory is an interface.** `save` / `search` / `summarize` is the only contract the core
   depends on. Never fork or hard-depend on a specific backend (engram included).
3. **Human-in-the-loop.** The retro proposes; a human disposes. No autonomous rule writes.
   Applied triage-gated on the forward path: critical changes keep a human gate, trivial ones do not.
4. **Rules carry receipts.** Every rule — and every check — cites the signals/decisions that created it.
5. **Anti-scope is policy.** Not a spec framework, not a memory server (see VISION.md).
6. **Determinism by default.** The LLM is called only for irreducible judgment; `src/core/` never
   calls one. Enforced by the import boundary, not by discipline. The alternative — trusting the
   prompt — is what makes agent tooling unreproducible.
7. **A judgment check earns its `block`.** Deterministic checks may block freely. An `agent-lens`
   check may block only after passing calibration: correct and unanimous over known-good and
   known-bad fixtures. Otherwise it is capped at `warn`/`annotate`.

Rules 6 and 7 originate in ADR-0008; rules 1–5 predate it and are unchanged.

## Stack facts

- **Language:** TypeScript on Node 24. Chosen over Go because portability is solved (Bun `--compile`),
  which erased Go's only advantage, and familiarity dominates for a single builder.
- **CLI:** commander v14. **Tests:** Vitest, strict TDD on `src/core/`.
- **Architecture:** FCIS — pure `core/` + thin `shell/` adapters, one-way imports.
- **LLM boundary:** one `LlmJudge` port; the beta adapter shells out to `claude -p` (uses the Max
  subscription, no API key). Adding a model is one adapter, zero core changes.
- **Distribution:** `npx wst` for dev; Bun `--compile` to a portable binary later. Deferred until the
  engine earns it (ADR-0004/0005).

See `.sdd/architecture.md` for how these fit together.
