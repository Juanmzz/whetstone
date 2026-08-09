---
id: triage-rules
generated: 2026-07-13     # hand-seeded — Whetstone predates its own wizard (see AGENTS.md)
updated: 2026-08-07       # ADR-0008: the emitter became code; strict regains its full-TDD meaning
status: active
---
# Triage rules

Classify every change into a discipline level BEFORE work starts.

| Level    | Applies to | Discipline |
| -------- | ---------- | ---------- |
| `strict` | **The deterministic engine** — `src/core/**`: triage, check selection, receipts, the gate verdict, the LLM verdict contract. A bug here silently mis-gates every change in every project that runs Whetstone. Also **the payload that PROPAGATES verbatim** to bootstrapped projects: `.sdd/skills/**`, the schemas (`docs/woz/SPEC.md` — signal, ADR, memory-adapter, directory contract), and the emitter/compiler output (`.claude/hooks/**`). Keywords: schema, emitter, compiler, gate, receipt, verdict, skill rule, contract, `.sdd/` template. | **Full TDD — RED→GREEN→TRIANGULATE→REFACTOR.** No exceptions: this is code now. For the non-code payload (skills, schemas), a fresh-context review and a worked example before it ships. Blast radius is every future project |
| `light`  | The imperative shell (`src/shell/**` — thin adapters, integration-tested not unit-tested), commands, and governance/design prose that does NOT propagate: `VISION.md`, `README.md`, `AGENTS.md`, `docs/woz/OPEN_QUESTIONS.md`, ADR bodies. | reasoned before merge; no test ceremony |
| `off`    | trivial: typos, formatting, `## Changelog` lines, `retro-log.md` entries | no ceremony |

Default when a change matches nothing above: `light`.

**Tier is the MAXIMUM of the files touched** — one `src/core/` file in a diff makes the whole change
`strict`. Size only escalates, never de-escalates.

> **Changed 2026-08-07 (ADR-0008).** This file previously carried a note that Whetstone was
> Wizard-of-Oz (markdown, no code), so `strict` meant contract/blast-radius discipline rather than
> test suites — "the moment the emitter becomes code (V1), `strict` regains its full-TDD meaning."
> That moment has arrived. `src/core/**` is now the primary strict surface.

This file **is** retro-amendable. `.claude/hooks/strict-path-guard.mjs` is COMPILED from the `strict`
row above (ADR-0005) — change this table and regenerate the hook, never the reverse.
