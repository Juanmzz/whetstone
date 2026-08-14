# Whetstone — agent orientation

> **Keep this file thin.** Per ADR-0002 the content lives in `.wst/` and vendor files render
> from it. If you are about to explain architecture here, put it in `.wst/architecture.md` and
> link instead.
>
> ⚠ This file went stale five times before anything checked it. `docs-fresh` now verifies the
> counts in the status block, which is the part that drifted; the prose is still hand-maintained
> and **`.wst/` is authoritative wherever the two disagree.**

Whetstone is a **self-sharpening standards layer** for AI coding agents. It captures a
project's definition of *correct* as plain files in git, enforces it with a deterministic
engine that calls an LLM only where judgment is irreducible, and grows the checks a project
needs from the friction it actually hits. Not a spec framework, not a memory server.

## Read first

1. **`.wst/architecture.md`** — the single statement of what is true now: the three parts, the
   loop, the layers, FCIS, the check registry, the measured `claude -p` invocation.
2. **`.wst/constitution.md`** — governance and the seven non-negotiables.
3. **`.wst/triage-rules.md`** — which discipline a change earns. Read BEFORE editing.
4. **`.wst/memory/decisions.md`** — every decision by anchor id, carrying what it ruled out.
   Open it when you are about to change one, not to learn how the system works.
5. **`docs/PARALLEL.md`** + **`.wst/lanes.yaml`** — if you are a crewmate in a lane.

## The commands

| | |
|---|---|
| `wst status` | repo, `.wst/`, judge health, version drift, whether the pre-push gate is armed |
| `wst check` | the check registry; refuses to load an uncalibrated blocking lens |
| `wst triage` | classify a diff → tier → which checks apply |
| `wst plan` | read a plan's declared `paths:` → predicted tier → which checks will judge it, split blocking/advisory, and which paths **nothing** covers. Reads, never authors; no LLM; **never blocks** (ADR-0013) |
| `wst gate` | run the checks, skip what receipts prove unchanged, pass or block, emit signals |
| `wst events` | read the log `gate` writes: a run's timeline, which check took how long, how it ended. Reads only — no LLM, no verdict, writes nothing |
| `wst prepare <task>` | lease a worktree, branch it, write the charter built from the live registry — then stop. Dispatches nothing, waits for nothing, and the lease is yours (ADR-0014) |
| `wst signal` | record an observation in `signals.jsonl`. **For the human to type** — it IS the [RC3] gate; an agent still proposes and waits |
| `wst retro` | cluster signals → propose rule changes → **never applies them** |
| `wst init` | interview a repo and generate its `.wst/` |

Useful flags: `gate --no-lens` (fast, free, what the hook runs) · `gate --no-emit` (do not
record signals; for when you are testing the gate itself) · `prepare --dry-run` (print the charter,
lease nothing) · `retro --dry-run` · `plan --json` (the full triage reason, untruncated) ·
`events --list` (every run, newest first) · `events --follow` (tail a run in progress). The plan
format is in `.wst/architecture.md`.

## Where things live

| Path | What |
|---|---|
| `.wst/` | The definition layer. Source of truth. |
| `.wst/checks/` · `lanes.yaml` · `triage.yaml` | Registry, lane ownership, triage rules |
| `.wst/memory/` | `decisions.md`, `signals.jsonl`, `retro-log.md`, `proposals/` |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy driving ports passed as PARAMETERS (retry, sequencing) |
| `src/shell/` | Thin adapters: git, claude, treehouse, sdd, signals, events, receipts, plugin |
| `scripts/calibrate.ts` · `scripts/mutate.ts` | Lens calibration · mutation testing |
| `.githooks/pre-push` · `.github/workflows/gate.yml` | Where the gate actually runs |
| `docs/woz/` | Wizard-of-Oz reference specs. Not current procedure. |
| `.claude/hooks/` | Emitter output compiled from `.wst/`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`** — enforced by the SCHEMA. An `agent-lens` declaring
   `severity: block` without a passing calibration receipt will not load.
3. **Only a real check failure may block.** A check that could not RUN (spawn, budget, timeout,
   auth, invalid output) is the gate being broken, not a verdict. Never merge the two, and never
   let "no checks ran" share a message with "all checks passed".
4. **Strict tier = full TDD, RED first** — `src/core/**` and anything propagating to
   bootstrapped projects. RED first is the discipline; **separate RED and GREEN commits are
   not.** One commit per coherent change, with the red output quoted in the commit body as
   the evidence the test came first ([TD1]/[TD2]).
5. **Lane boundaries are enforced, not requested.** `lane-guard.mjs` DENIES out-of-lane writes.
   If it blocks you, the split is wrong — say so rather than working around it.
6. **Decisions change by status, never by rewrite** (ADR-0007, as ADR-0019 inherits it), and live
   as anchors in `.wst/memory/decisions.md` — one entry, carrying what it ruled out, its status
   and its date. A change with no seriously weighed alternative is a commit message, not a
   decision (ADR-0017). Compacting an entry is selecting, not editing (ADR-0019); the full text
   is in git (`git log --diff-filter=D -- .wst/memory/decisions/`).
7. **The payload must be self-contained.** Anything `init` writes into a target repo may not
   reference Whetstone's own files — it dangles there (ADR-0004). Enforced by a reference-closure
   check that refuses to emit a plan naming a path it does not create.
8. **Ground API claims against the docs before writing code** — prefer Context7.
9. **Judge = hermetic.** `shell/claude.ts` strips the target repo's MCP, hooks and `AGENTS.md` so
   a repo cannot hijack its own reviewer. A charged judge — one the repo under review can tell
   what to think of it — is a serious bug. A hermetic judge cannot resolve a path, so everything
   it must judge is inlined (delegation D7). The other half of this pair, `shell/crewmate.ts`,
   is gone (ADR-0014): a crewmate now runs in a session a human opens, charged by construction,
   and the charter `wst prepare` leaves in the worktree is what orients it.
10. **Isolate a negative control.** When you break something on purpose to prove a check catches
    it, that defect must be the ONLY uncommitted change, and use `--no-emit`. Twice now it has
    contaminated something else: real work (`sig-0025`) and the evidence log (`sig-0026`).

## Memory

Backend is `files`; `.wst/memory/` is the source of truth, human-gated. **Engram namespace is
`whetstone`.** Never save Whetstone work under `chytapay-workspace`.

## Status — branch `main` · 20 ADRs · 51 signals · 10 commands

<!-- Checked by `docs-fresh`. Run `npm run check:docs` after changing anything it counts. -->

ADR-0008 records the pivot from Wizard-of-Oz to a TS engine, discharging ADR-0004 for
`init`/`retro` and **explicitly waiving** it for the gate, registry and triage. PR annotation was
built under that waiver and removed by ADR-0009.

- **The loop is closed and self-hosting.** `wst gate` verifies this repo's own changes and now
  writes its own signals; `wst run` dispatched a crewmate whose work was gated before a human saw
  it — that command is now `wst prepare` and gates nothing (ADR-0014), so enforcement on a
  crewmate's work is the push and CI; `wst retro` has run three times, producing amendments
  across seven of the eight skills, each carrying the signals that earned it. The pre-push hook is armed (`core.hooksPath=.githooks`) and CI runs the
  full gate on every PR.
- **51 signals**, 27 with `resolved_by`. Three retros. Seven of eight skills amended:
  `tdd-discipline` v6, `delegation` v4, `xreview` v3, `doc-locations` v3, `voice` v2,
  `recording` v2, `lazy` v2. Only `token-economy` is still at v1.
- **`correctness`** is an agent-lens at `warn`, `uncalibrated` at lens v4. It may not block until
  re-measured unfiltered. v3 failed the bar on false positives, which is the system working.

### Known weaknesses, stated plainly

- **47 of 51 signals are hand-authored prose.** One carries a `source` (`sig-82dec46b`, typed by
  the human about an incident that actually happened). **`sig-a9ff00c4` is the first to carry `source: "gate"`** — written on
  2026-08-14 when `docs-fresh` blocked a change that added an ADR without updating this line.
  Before it, CI emitted `sig-70ad13db` on an ephemeral runner and it evaporated. The gap was
  never "the gate does not fail"; it was that where the gate really runs, nothing persisted
  what it observed.
- **The lens is uncalibrated at v4**, so the differentiator is advisory.
- **Mutation score 85%** over a 40-mutation sample; the suite catches real bugs but the sample
  was small.
- **Unowned:** ADR-0006's updater has no home in the roadmap; no skill owns subprocess-exit-code
  conventions (a retro proposal was declined for want of a home).
