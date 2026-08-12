# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures a project's definition of *correct* — its constitution, its risk triage, and the
checks that matter — as plain files in git, then enforces it with a deterministic engine that calls
an LLM only where judgment is irreducible. Routine changes run autonomously; the ones your project
calls critical keep a human in the loop. The gate's exit code is the whole enforcement surface: it
runs in a pre-push hook and in CI, so it does not depend on an agent choosing to cooperate. And
because it records the friction it hits, the checks a project needs grow
and tighten over time — each carrying a receipt for why it exists.

> Status: alpha (v0.4.0). The gate has landed and runs on this repo's own changes, in a pre-push
> hook and in CI. What is not done is the judgment tier: the lens is `uncalibrated` at v4, so it may
> only warn. The retro loop has produced its first earned rule from a real project. Read
> [VISION.md](./VISION.md) first.

## Why

Most of what a senior engineer does to guarantee quality is already deterministic — tests, linters,
type checks, review checklists. The LLM's unique contribution is **judgment**. Whetstone splits the
work along that line: the engine does the mechanical 80%, cheap and reproducible, and an agent is
applied to the remaining 20%, only where the change is critical.

The consequence is frugality in *verification*. Tools that review everything with an agent are
expensive and slow; a `CLAUDE.md` full of rules is merely advisory. Whetstone is neither — it is the
layer that makes a non-negotiable actually non-negotiable.

## How it works

```
wst init   → interview the project, generate .wst/
wst run    → triage → plan gate (critical changes only) → dispatch → gate → branch
wst gate   → select checks → skip what receipts prove unchanged → run → pass or block
wst retro  → cluster signals → propose checks → human approves → amend with a receipt
```

*Shipped today: all eight commands — `status`, `check`, `triage`, `gate`, `run`, `retro`, `signal`,
`init` — as a TypeScript engine (ADR-0008). `wst pr` was removed by ADR-0009: the gate's exit code
is the whole enforcement surface, and a second channel that only advised was one more thing to keep
honest. The Wizard-of-Oz procedures under [`docs/woz/`](./docs/woz/) are reference specs, not
current procedure.*

The loop is self-hosting: `wst gate` verifies this repo's own changes, `wst run` has dispatched a
crewmate whose work was gated before a human saw it, and `wst retro` has produced amendments across
four skills, each carrying the signals that earned it. **`wst run` needs [`treehouse`](https://github.com/kunchenguid/treehouse)
for worktree isolation, and agent-lens checks need the `claude` CLI; neither is bundled.** What is
still weak is stated in [AGENTS.md](./AGENTS.md#known-weaknesses-stated-plainly) — chiefly that the
lens is uncalibrated at v4, so the judgment tier is advisory.

1. **`.wst/` is data.** Constitution, triage rules, and a registry of checks — one file per check,
   each declaring what it triggers on, whether it is deterministic or judgment, and whether it may
   block or only warn.
2. **The engine is code.** It classifies changes by glob, selects checks, hashes inputs so unchanged
   code is never re-reviewed, runs what remains, and enforces the result.
3. **The LLM is judgment only.** One boundary, one port, swappable adapters. A judgment check must
   prove it is correct and stable over fixtures before it is allowed to block anything — otherwise
   it is capped at `warn`. A flaky gate gets routed around, and then it is worth less than nothing.
4. **The loop closes.** Signals accumulate as you work; the retro proposes new or amended checks;
   you approve; the change lands with a changelog linking back to the evidence.

## Non-goals

Not a spec-driven framework (it composes with Spec Kit, BMAD, Superpowers). Not a memory server
(memory is an interface; files are the default backend). Not a fleet manager — it delegates
worktrees, GitHub and execution to tools that already do those well. See
[VISION.md](./VISION.md#what-whetstone-is-not).

## Roadmap

- **M1 — Bootstrap** ✅ — the init procedure, `.wst/` schema, eight-skill set, signal logging.
- **M2 — Code tier** ✅ — the emitter compiles `.wst/` into per-vendor apparatus, hooks first.
- **M3 — The retro loop** ✅ *(first pass)* — pattern detection + apparatus recommendation, validated
  in the wild. Still N=1; repeatability unproven.
- **M4 — The engine** ← *current* — `wst` CLI, deterministic core, calibrated LLM boundary, check
  registry, lean gate with receipts.
- **M5 — Update model** — keep bootstrapped projects current via 3-way merge; contribute upstream.
- **Distribution** — `npx wst` / optional plugin. Deliberately last: the payload is the value, the
  installer is a wrapper.

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
