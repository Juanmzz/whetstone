---
id: triage-rules
generated: 2026-07-13     # hand-seeded; Whetstone predates its own wizard (see AGENTS.md)
updated: 2026-08-30       # ADR-0046: the yaml splits into what travels and what does not
status: active
---
# Triage rules

Classify every change into a discipline level BEFORE work starts.

| Level | Globs, as `triage.yaml` declares them | Discipline |
| --- | --- | --- |
| `strict` | `src/core/**` · `.wst/skills/**` · `.claude/hooks/**` · `plugin/**` | **Full TDD, RED first.** The deterministic engine, where a bug silently mis-gates every change in every project that runs Whetstone. Plus the payload that propagates verbatim to bootstrapped repos, and the plugin, which installs into somebody else's session |
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
reads (`shell/sdd.ts`). Nothing parses this page.

**The yaml has two halves** (ADR-0046). Above the `BELOW HERE` marker is `DEFAULT_RULES_YAML`
in `core/triage/rules.ts`, pinned to it byte-for-byte by `test/triage-defaults.test.ts`: it
is what a repo with no `triage.yaml` of its own is triaged by, so nothing there may name a
path that exists only in Whetstone. Below it are this repo's own rules, `plugin/**` among
them. They land last, and precedence is first-match-wins, so a rule there has to be
narrower than everything above it.

adr-0005 named it the source and adr-0005 was right at the time, because the hook it compiled to
was real. That hook is gone, nothing ever compiled the YAML from this table, and the two
drifted: this page omits `src/commands/**`, `src/cli.ts` and `docs/**`, all of which the
YAML carries. A declared source nobody reads is worse than no declaration, because a
reader edits it and expects an effect.

So: **edit `triage.yaml`, then update this page to match.** It is still retro-amendable;
what changes is which of the two is authoritative.
