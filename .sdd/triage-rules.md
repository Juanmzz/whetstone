---
id: triage-rules
generated: 2026-07-13     # hand-seeded — Whetstone predates its own wizard (see CLAUDE.md)
status: active
---
# Triage rules

Classify every change into a discipline level BEFORE work starts.

| Level    | Applies to                                                                                                                                                                                                                                            | Discipline |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `strict` | The payload and contracts that PROPAGATE to every bootstrapped project: the skills copied verbatim (`.sdd/skills/**`), the schemas (`SPEC.md` — signal, ADR, memory-adapter, directory contract), and the emitter/compiler logic (`init.md` phases 3–4, and `retro.md` — init's twin, same blast radius). When the V1 emitter becomes code, that code is strict too. Keywords: schema, emitter, compiler, skill rule, contract, `.sdd/` template. | full TDD once code exists (RED→GREEN→TRIANGULATE→REFACTOR); until then a change here needs a fresh-context review and a worked example before it ships — blast radius is every future project |
| `light`  | Governance/design prose that does NOT propagate to bootstrapped projects: `VISION.md`, `README.md`, `OPEN_QUESTIONS.md`, ADR bodies.                                                                                                                  | reasoned before merge; no test ceremony |
| `off`    | trivial: typos, formatting, `## Changelog` lines, `retro-log.md` entries                                                                                                                                                                              | no ceremony |

Default when a change matches nothing above: `light`.

Note: at v0.1.x Whetstone is Wizard-of-Oz (markdown, no code), so `strict` means
contract/blast-radius discipline, not test suites. The moment the emitter becomes code (V1),
`strict` regains its full-TDD meaning. This file **is** retro-amendable.
