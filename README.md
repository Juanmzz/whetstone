# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures a project's definition of *correct* — its constitution, its risk
triage, and the checks that matter — as plain files in git, then enforces it with a
deterministic engine that calls an LLM only where judgment is irreducible.

The exit code is the whole enforcement surface: it runs in a pre-push hook and in CI,
so it does not depend on an agent choosing to cooperate. And because the tool records
the friction it hits, the checks a project needs grow from what actually went wrong —
each carrying a receipt for why it exists.

> **Status: alpha (v0.5.0).** The gate runs on this repo's own changes. The judgment
> tier is measured but not earned: the review lens returned 98 correct verdicts out of
> 100 and got none wrong, and is still capped at `warn` because two runs never came
> back at all. A lens that cannot answer cannot gate.
> [AGENTS.md](./AGENTS.md) carries the current numbers and
> [what is still weak](./AGENTS.md#known-weaknesses-stated-plainly) — checked by a gate
> check, so this file does not repeat them.

## Why

Most of what a senior engineer does to guarantee quality is already deterministic —
tests, linters, type checks, review checklists. The LLM's unique contribution is
**judgment**. Whetstone splits the work along that line, which makes verification
frugal: reviewing everything with an agent is expensive and slow, and a `CLAUDE.md`
full of rules is merely advisory.

## The shape of it

```
wst init    → interview the project, generate .wst/
   ↓          the work happens: any agent, or a person. .wst/ is in the repo
wst gate    → select checks → skip what receipts prove unchanged → pass or block
wst signal  → a human records the friction the run hit
wst retro   → cluster signals → propose changes → a human approves → back to .wst/
```

`status`, `check`, `triage` and `events` read that machinery back; none of them decide
anything.

## Reading further

- **[`docs/architecture.md`](./docs/architecture.md)** — the full picture, in the
  present tense. It is the authority; anything that disagrees with it is drift.
- **[`docs/design.md`](./docs/design.md)** — where to read about each part, and the
  anatomy of a check file.
- **[`.wst/memory/decisions.md`](./.wst/memory/decisions.md)** — what was decided and
  what each decision ruled out. There is no roadmap: this project has changed shape
  twice, and a milestone list is what keeps claiming the old one.

**Not bundled:** `llm` checks need the `claude` CLI. Nothing else.

**Not this:** a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers),
a memory server (memory is an interface; files are the default), or a fleet manager.
[VISION.md](./VISION.md#what-whetstone-is-not) says why.

## Development

```bash
npm install
npm test          # no network, no token cost
npm run typecheck
npm run build && node dist/cli.js status
npm run calibrate # spends real tokens: measures llm verdict stability
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
