# Whetstone: agent orientation

> **Keep this file thin.** Per ADR-0002 the content lives in `.wst/` and vendor files render
> from it. If you are about to explain architecture here, put it in `docs/architecture.md` and
> link instead.
>
> ⚠ This file went stale five times before anything checked it. `docs-fresh` now verifies the
> counts in the status block, which is the part that drifted; the prose is still hand-maintained
> and **`.wst/` is authoritative wherever the two disagree.**

Whetstone answers one question for an AI coding agent: **is this task's work ready?** A
project's checks live as plain files in git; `wst ready` finds what the task changed, runs the
checks those paths need, and gives one honest answer. A deterministic engine does the work and
calls an LLM only where judgment is irreducible. Not a spec framework, not a memory server.


## Read first

1. **`docs/architecture.md`** states what is true now: the three parts, the
   loop, the layers, FCIS, the check registry, the measured `claude -p` invocation.
2. **`.wst/constitution.md`**: governance and the seven non-negotiables.
3. **`.wst/triage-rules.md`**: which discipline a change earns. Read BEFORE editing.
4. **`.wst/memory/decisions.md`**: every decision by anchor id, carrying what it ruled out.
   Open it when you are about to change one, not to learn how the system works.
5. **`docs/PARALLEL.md`** + **`docs/lanes.yaml`**, if you are a crewmate in a lane.

## The commands

Three of them are the product. The rest are diagnostics or compatibility (adr-0048, adr-0049).

| | |
|---|---|
| `wst init` | interview a repo and write `.wst/`: the checks it can run, and how to route them. Nothing else |
| `wst ready` | **zero arguments.** Resolves what this task changed, runs the checks, answers READY, NOT_READY, INCOMPLETE or NO_CHANGES |
| `wst status` | repo, `.wst/`, judge health, whether the push gate is armed |

**Diagnostic**, for agents and maintainers: `wst triage` (classify a change, run nothing) and
`wst check` (the registry; `check run <id>` runs one whose logic ships with `wst`).

**Compatibility**: `wst gate` runs the checks over a range somebody passes. `ready` reuses its
engine and resolves the range itself; the hook and CI still name `gate`.

**Deleted**: `config` (adr-0048); `signal`, `retro`, `update` and the launcher (adr-0049).
`git checkout v0.9.0` restores them; their data stays in `.wst/memory/`.

Useful flags: `ready --json` (an envelope with a semantic `result` field) · `ready --range`
(an override for CI and diagnostics) · `gate --no-lens` · `gate --fast`.

## Where things live

| Path | What |
|---|---|
| `.wst/` | The definition layer. Source of truth. |
| `.wst/checks/` · `lanes.yaml` · `triage.yaml` | Registry, lane ownership, triage rules |
| `.wst/memory/` | `decisions.md`; `signals.jsonl` and `retro-log.md` are the record of the retired loop (adr-0049) |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy driving ports passed as PARAMETERS (retry, sequencing) |
| `src/shell/` | Thin adapters: git, claude, sdd, receipts, plugin |
| `scripts/calibrate.ts` · `scripts/mutate.ts` | Lens calibration · mutation testing |
| `.githooks/pre-push` · `.github/workflows/gate.yml` | Where the gate actually runs |
| `.claude/hooks/` | Emitter output compiled from `.wst/`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`**, enforced by the SCHEMA. An `agent-lens` declaring
   `severity: block` without a passing calibration receipt will not load.
3. **Only a real check failure may block.** A check that could not RUN (spawn, budget, timeout,
   auth, invalid output) is the gate being broken, not a verdict. Never merge the two, and never
   let "no checks ran" share a message with "all checks passed".
4. **Strict tier = full TDD, RED first** for `src/core/**` and anything propagating to
   bootstrapped projects. RED first is the discipline; **separate RED and GREEN commits are
   not.** One commit per coherent change ([TD1]/[TD2]). Do not quote the red output in the
   body: it is a claim nothing can check, and tdd-discipline v7 dropped it.
5. **Lane boundaries are enforced, not requested.** `lane-guard.mjs` DENIES out-of-lane writes.
   If it blocks you, the split is wrong. Say so rather than working around it.
6. **Decisions change by status, never by rewrite** (ADR-0007, as ADR-0019 inherits it), and live
   as anchors in `.wst/memory/decisions.md`: one entry, carrying what it ruled out, its status
   and its date. A change with no seriously weighed alternative is a commit message, not a
   decision (ADR-0017). Compacting an entry is selecting, not editing (ADR-0019); the full text
   is in git (`git log --diff-filter=D -- .wst/memory/decisions/`).
7. **The payload must be self-contained.** Anything `init` writes into a target repo may not
   reference Whetstone's own files, which dangle there (ADR-0004). Enforced by a reference-closure
   check that refuses to emit a plan naming a path it does not create.
8. **Ground API claims against the docs before writing code.** Prefer Context7.
9. **Judge = hermetic.** `shell/claude.ts` strips the target repo's MCP, hooks and `AGENTS.md` so
   a repo cannot hijack its own reviewer. A charged judge, one the repo under review can tell
   what to think of it, is a serious bug. A hermetic judge cannot resolve a path, so everything
   it must judge is inlined (delegation D7). The other half of this pair, `shell/crewmate.ts`,
   is gone (ADR-0014): a crewmate now runs in a session a human opens, charged by construction,
   and `.wst/` is what orients it. `wst prepare`, which used to write that briefing, is gone
   too (ADR-0023).
10. **Isolate a negative control.** When you break something on purpose to prove a check catches
    it, that defect must be the ONLY uncommitted change, and use `--no-emit`. Twice now it has
    contaminated something else: real work (`sig-0025`) and the evidence log (`sig-0026`).

## Memory

Backend is `files`; `.wst/memory/` is the source of truth, human-gated. **Engram namespace is
`whetstone`.** Never save Whetstone work under another project's namespace.

<!-- Checked by `docs-fresh`. Run `npm run check:docs` after changing anything it counts. -->
## Status: branch `main` · 49 ADRs · 66 signals · 7 commands

- **The product is `ready`.** `wst gate` verifies this repo's own changes on push and in CI:
  the pre-push hook is armed (`core.hooksPath=.githooks`) and CI runs the gate on every PR.
- **`correctness` does NOT block.** Its calibration receipt records `model: sonnet` while the
  check routes to `opus`, so adr-0045 lapsed the block on 2026-08-30. One `calibrate` run
  against `opus`, or a `signed_block` (adr-0047), restores it. `wst check` prints `BLOCK*`
  for signed authority.

### Known weaknesses, stated plainly

- **The verdict's detail is thin.** A failing check reports one line of its output, and
  INCOMPLETE does not always say why. Both are the next release's first work.
- **Every check runs at once.** On a repo with heavy checks that contention may produce
  false NOT_READY; unmeasured.
- **Selection is by path, not by dependency graph.** A change a check covers runs that
  check's whole command.
- **Seven of the twelve checks are Whetstone-only**: `adr-refs`, `command-surface`,
  `docs-fresh`, `in-force`, `run-the-lens`, `skill-shape` and `strict-tdd`. `init` seeds none.
