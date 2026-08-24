# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures a project's definition of *correct* — its constitution, its risk
triage, and the checks that matter — as plain files in git, then enforces it with a
deterministic engine that calls an LLM only where judgment is irreducible.

The exit code is the whole enforcement surface: it runs in a pre-push hook and in CI,
so it does not depend on an agent choosing to cooperate. And because the tool records
the friction it hits, the checks a project needs grow from what actually went wrong —
each carrying a receipt for why it exists.

> **Status: alpha.** The gate runs on this repo's every push and PR.
>
> **The judgment tier is advisory.** The review lens is capped at `warn`, so everything
> that can block here today is something a linter could also have caught.
> [AGENTS.md](./AGENTS.md) says why, and carries the numbers — checked by a gate check,
> so this file does not repeat them.

## Why

Most of what a senior engineer does to guarantee quality is already deterministic —
tests, linters, type checks, review checklists. The LLM's unique contribution is
**judgment**. Whetstone splits the work along that line, which makes verification
frugal: reviewing everything with an agent is expensive and slow, and a `CLAUDE.md`
full of rules is merely advisory.

## The shape of it

```
wst init    → interview the project, generate .wst/, record a base beside it
   ↓          the work happens: any agent, or a person. .wst/ is in the repo
wst gate    → select checks → skip what receipts prove unchanged → pass or block
wst signal  → a human records the friction the run hit
wst retro   → cluster signals → propose changes → a human approves → back to .wst/
```

`wst update` re-plans from that base and reports what changed since — what you edited by
hand, what a newer Whetstone would write differently. It writes nothing.

`status`, `check` and `triage` read the machinery back; none of them decide anything.
`wst opinion` lists the rules Whetstone offers that no repo declares, and the friction that
earned each. `init` asks before writing any of them, and never writes one unasked.

## Reading further

- **[`docs/architecture.md`](./docs/architecture.md)** — the full picture, in the
  present tense. It is the authority; anything that disagrees with it is drift.
- **[`docs/design.md`](./docs/design.md)** — where to read about each part, and the
  anatomy of a check file.

**Not bundled:** an `llm` check needs the `claude` or `gemini` CLI, whichever it names.
Nothing else.

**Not this:** a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers),
a memory server (memory is an interface; files are the default), or a fleet manager.
[VISION.md](./VISION.md#what-whetstone-is-not) says why.

## Development

```bash
npm install
npm test          # no network, no token cost
npm run typecheck
npm run build && node dist/cli.js status
npm run calibrate # spends real tokens: measures one llm check's stability
                  #   `-- --check <id>` picks which
```

`src/core/` is pure and strictly TDD'd; `src/shell/` holds thin adapters. A test
enforces that the core can never import an adapter — which is what makes "the LLM is
judgment only" an architectural fact rather than a promise.

## Contributing

1. **Read [VISION.md](./VISION.md) first**, especially "What Whetstone is NOT". PRs
   pulling this toward a spec framework or a memory server get kindly redirected.
2. **One concern per PR.** Past ~300 lines of diff, open an issue so we can split it.

## License

MIT
