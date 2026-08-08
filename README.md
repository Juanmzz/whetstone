# Whetstone

**Self-sharpening standards for coding agents.**

Whetstone captures a project's definition of *correct* — its constitution, its risk triage, and the
checks that matter — as plain files in git, then enforces it with a deterministic engine that calls
an LLM only where judgment is irreducible. Routine changes run autonomously; the ones your project
calls critical keep a human in the loop. Every task ends in a PR annotated with **where a human
should actually look**. And because it records the friction it hits, the checks a project needs grow
and tighten over time — each carrying a receipt for why it exists.

> Status: alpha (v0.4.0). The engine is under construction — the CLI skeleton and the calibrated LLM
> boundary landed; the gate is next. The retro loop has produced its first earned rule from a real
> project. Read [VISION.md](./VISION.md) first.

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
wst init   → interview the project, generate .sdd/
wst run    → triage → plan gate (critical changes only) → dispatch → gate → annotated PR
wst gate   → select checks → skip what receipts prove unchanged → run → pass or block
wst retro  → cluster signals → propose checks → human approves → amend with a receipt
```

*Shipped today: `wst status`.* The rest is the target shape — `init` and `retro` exist as validated
procedures under [`docs/woz/`](./docs/woz/) and are being ported to code; `gate` and `run` are next.

1. **`.sdd/` is data.** Constitution, triage rules, and a registry of checks — one file per check,
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

- **M1 — Bootstrap** ✅ — the init procedure, `.sdd/` schema, eight-skill set, signal logging.
- **M2 — Code tier** ✅ — the emitter compiles `.sdd/` into per-vendor apparatus, hooks first.
- **M3 — The retro loop** ✅ *(first pass)* — pattern detection + apparatus recommendation, validated
  in the wild. Still N=1; repeatability unproven.
- **M4 — The engine** ← *current* — `wst` CLI, deterministic core, calibrated LLM boundary, check
  registry, lean gate with receipts, annotated PR.
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
