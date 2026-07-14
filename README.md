# Whetstone

**Self-sharpening workflows for coding agents.**

Whetstone gives your agent workflow a memory and a feedback loop. As you use an AI on a project, it records the friction (signals) and the decisions, then **recommends the guardrails that project actually needs** — a new skill, a hook, a command, or an amendment to an existing rule — with a human gate and a full audit trail. Rules carry receipts: every rule links back to the signals that earned it.

> Status: alpha (v0.3.0). The retro loop — the thesis — has produced its first earned rule from a real project. Wizard-of-Oz (agent-driven procedures, not a CLI yet). See [VISION.md](./VISION.md) first.

## How it works

```
use → record → distill → amend
```

1. `whetstone init` interviews your project and generates a `.sdd/` directory: constitution, triage rules, and a starter skill set.
2. As you work, signals and decisions are logged to `.sdd/memory/` (plain files, versioned in git — no server required).
3. `/retro` reads what accumulated, detects patterns, and recommends apparatus — a new skill/hook/command, or a diff to an existing rule (curating a proven one when it fits, generating a project-specific one when it doesn't). You approve; the change lands with a changelog entry linking back to the evidence.

## Non-goals

Whetstone is **not** a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers) and **not** a memory server (memory is an interface; plain files are the default backend, engram/MCP backends are optional adapters). See [VISION.md](./VISION.md#what-whetstone-is-not).

## Roadmap

- **M1 — Bootstrap** ✅: the init procedure, `.sdd/` schema, eight-skill set, signal logging. Dogfooded on a real project.
- **M2 — Code tier** (in progress): the emitter compiles `.sdd/` into per-vendor apparatus — hooks first (a project-specific `strict-path-guard` ships today), then agents/commands, earned via the retro.
- **M3 — The retro loop** ✅ (first pass): pattern detection + apparatus recommendation. Validated in the wild — a real project's signals produced the first earned rule (TD6). Next: make it repeatable and semi-automated.
- **M4 — Update model** ([ADR-0006](./.sdd/memory/decisions/0006-update-model-3way-merge-via-git.md)): keep bootstrapped projects current via 3-way merge; contribute local amendments upstream.
- **M5 — Distribution**: `npx whetstone` CLI / optional plugin, for use beyond the author.

## Contributing

Contributions are welcome, with two rules:

1. **Read [VISION.md](./VISION.md) first** — especially the "What Whetstone is NOT" section. PRs that pull the project toward being a spec framework or a memory server will be (kindly) redirected.
2. **Small, atomic PRs.** One concern per PR. A PR that touches the `.sdd/` schema should not also refactor the CLI. If your change needs more than ~300 lines of diff, open an issue first so we can split it.

Good first issues are labeled `good-first-issue` and target M1: skill genericization and `.sdd/` schema review.

## License

MIT
