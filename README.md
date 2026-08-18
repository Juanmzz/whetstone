# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures a project's definition of *correct* — its constitution, its risk triage, and the
checks that matter — as plain files in git, then enforces it with a deterministic engine that calls
an LLM only where judgment is irreducible. Routine changes run autonomously; the ones your project
calls critical keep a human in the loop. The gate's exit code is the whole enforcement surface: it
runs in a pre-push hook and in CI, so it does not depend on an agent choosing to cooperate. And
because it records the friction it hits, the checks a project needs grow and tighten over time —
each carrying a receipt for why it exists.

> **Status: alpha (v0.5.0).** The gate runs on this repo's own changes, in a pre-push hook and in
> CI. The judgment tier is not done — the review lens is uncalibrated, so it may only warn.
> [AGENTS.md](./AGENTS.md) carries the current numbers and
> [what is still weak](./AGENTS.md#known-weaknesses-stated-plainly), stated plainly and checked by
> a gate check. This file does not repeat them, because the copy is what goes stale.

## Why

Most of what a senior engineer does to guarantee quality is already deterministic — tests, linters,
type checks, review checklists. The LLM's unique contribution is **judgment**. Whetstone splits the
work along that line: the engine does the mechanical 80%, cheap and reproducible, and an agent is
applied to the remaining 20%, only where the change is critical.

The consequence is frugality in *verification*. Tools that review everything with an agent are
expensive and slow; a `CLAUDE.md` full of rules is merely advisory. Whetstone is neither — it is the
layer that makes a non-negotiable actually non-negotiable.

## The shape of it

```
wst init    → interview the project, generate .wst/
wst plan    → a plan's declared paths → tier → what will judge it, and what nothing covers
wst prepare → lease a worktree → branch → write the charter the live registry generates → stop
wst gate    → select checks → skip what receipts prove unchanged → run → pass or block
wst events  → read the log back: what a run did, which check took how long, how it ended
wst retro   → cluster signals → propose checks → human approves → amend with a receipt
```

**[`.wst/architecture.md`](./.wst/architecture.md) is the full picture** — the three parts, the loop
as a diagram, the layers, the check registry, the plan format, and the measured `claude -p`
invocation. It is written in the present tense and it is the authority; anything here that
disagrees with it is drift.

**What is not bundled:** `wst prepare` needs [`treehouse`](https://github.com/kunchenguid/treehouse)
for worktree isolation, and judgment checks need the `claude` CLI.

**What is not built, and what was refused,** live in
[`.wst/memory/decisions.md`](./.wst/memory/decisions.md) — one entry per decision, each carrying
what it ruled out. There is no roadmap here: this project has changed shape twice by decision,
and a list of milestones is the thing that keeps claiming the old shape.

## Non-goals

Not a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers). Not a memory server
(memory is an interface; files are the default backend). Not a fleet manager — it delegates
worktrees, GitHub and execution to tools that already do those well. See
[VISION.md](./VISION.md#what-whetstone-is-not), and
[`.wst/memory/decisions.md`](./.wst/memory/decisions.md) for what each of those refusals ruled out
and why.

## Development

```bash
npm install
npm test          # no network, no token cost
npm run typecheck
npm run build && node dist/cli.js status
npm run calibrate # spends real tokens: measures agent-lens verdict stability
```

The core (`src/core/`) is pure and strictly TDD'd; adapters (`src/shell/`) are thin. A test enforces
that the core can never import an adapter, which is what makes "the LLM is judgment only" an
architectural fact rather than a promise.

## Contributing

1. **Read [VISION.md](./VISION.md) first** — especially "What Whetstone is NOT". PRs that pull the
   project toward being a spec framework or a memory server will be (kindly) redirected.
2. **Small, atomic PRs.** One concern per PR. If your change needs more than ~300 lines of diff,
   open an issue first so we can split it.

## License

MIT
