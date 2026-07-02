# Whetstone

**Self-sharpening workflows for coding agents.**

Whetstone gives your agent workflow a memory and a feedback loop: incidents and decisions are recorded as you work, and a retro process proposes amendments to your workflow rules — with a human gate and a full audit trail. Rules carry receipts: every rule links back to the incidents that created it.

> Status: pre-alpha. Design phase — see [VISION.md](./VISION.md) before anything else.

## How it works

```
use → record → distill → amend
```

1. `whetstone init` interviews your project and generates a `.sdd/` directory: constitution, triage rules, and a starter skill set.
2. As you work, incidents and decisions are logged to `.sdd/memory/` (plain files, versioned in git — no server required).
3. `/retro` reads what accumulated, detects patterns, and proposes diffs to your skill files. You approve; the skill is amended with a changelog entry linking back to the evidence.

## Non-goals

Whetstone is **not** a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers) and **not** a memory server (memory is an interface; plain files are the default backend, engram/MCP backends are optional adapters). See [VISION.md](./VISION.md#what-whetstone-is-not).

## Roadmap

- **M1 — Bootstrap**: init wizard, `.sdd/` schema, generic skill set, manual incident logging.
- **M2 — Forward integration**: Claude Code plugin (commands, hooks), optional adapters.
- **M3 — The retro loop**: pattern detection + rule amendment proposals. The milestone that proves the thesis.

## Contributing

Contributions are welcome, with two rules:

1. **Read [VISION.md](./VISION.md) first** — especially the "What Whetstone is NOT" section. PRs that pull the project toward being a spec framework or a memory server will be (kindly) redirected.
2. **Small, atomic PRs.** One concern per PR. A PR that touches the `.sdd/` schema should not also refactor the CLI. If your change needs more than ~300 lines of diff, open an issue first so we can split it.

Good first issues are labeled `good-first-issue` and target M1: skill genericization and `.sdd/` schema review.

## License

MIT
