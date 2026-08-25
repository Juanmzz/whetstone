---
id: triage-rules
generated: 2026-07-13     # hand-seeded; Whetstone predates its own wizard (see AGENTS.md)
updated: 2026-08-07       # ADR-0008: the emitter became code; strict regains its full-TDD meaning
status: active
---
# Triage rules

Classify every change into a discipline level BEFORE work starts.

| Level | Globs, as `triage.yaml` declares them | Discipline |
| --- | --- | --- |
| `strict` | `src/core/**` · `.wst/skills/**` · `.claude/hooks/**` | **Full TDD, RED first.** The deterministic engine, where a bug silently mis-gates every change in every project that runs Whetstone. Plus the payload that propagates verbatim to bootstrapped repos |
| `light` | `src/shell/**` · `src/commands/**` · `src/cli.ts` · `docs/**` · `.wst/memory/decisions.md` · `{README,VISION,AGENTS,CLAUDE}.md` | Reasoned before merge, no test ceremony. Thin adapters, composition roots, and prose that does not propagate |
| `off` | `.wst/memory/retro-log.md` | No ceremony |

Default when a change matches nothing above: `light`.

**Tier is the MAXIMUM of the files touched.** One `src/core/` file in a diff makes the whole change
`strict`. Size only escalates, never de-escalates.

> **Changed 2026-08-07 (ADR-0008).** This file previously carried a note that Whetstone was
> Wizard-of-Oz (markdown, no code), so `strict` meant contract/blast-radius discipline rather than
> test suites: "the moment the emitter becomes code (V1), `strict` regains its full-TDD meaning."
> That moment has arrived. `src/core/**` is now the primary strict surface.

**This table is documentation, not the source.** `.wst/triage.yaml` is what the engine
reads (`shell/sdd.ts`), and `DEFAULT_RULES_YAML` in `core/triage/rules.ts` is pinned to it
byte-for-byte by `test/triage-defaults.test.ts`. Nothing parses this page.

adr-0005 named it the source and adr-0005 was right at the time, because the hook it compiled to
was real. That hook is gone, nothing ever compiled the YAML from this table, and the two
drifted: this page omits `src/commands/**`, `src/cli.ts` and `docs/**`, all of which the
YAML carries. A declared source nobody reads is worse than no declaration, because a
reader edits it and expects an effect.

So: **edit `triage.yaml`, then update this page to match.** It is still retro-amendable;
what changes is which of the two is authoritative.
