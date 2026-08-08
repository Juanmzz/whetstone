# Whetstone — agent orientation

> **Keep this file thin.** Per ADR-0002 the content lives in `.sdd/` and vendor files render
> from it. If you are about to explain architecture here, put it in `.sdd/architecture.md` and
> link instead.
>
> ⚠ This file has gone stale three times in a single session. That is not carelessness, it is
> structural: a hand-maintained vendor file drifts the moment work moves faster than
> documentation. `wst init` now generates exactly this file for target repos; making
> Whetstone's own copy emitter output is the obvious next step. **Until then, `.sdd/` is
> authoritative wherever the two disagree.**

Whetstone is a **self-sharpening standards layer** for AI coding agents. It captures a
project's definition of *correct* as plain files in git, enforces it with a deterministic
engine that calls an LLM only where judgment is irreducible, and grows the checks a project
needs from the friction it actually hits. Not a spec framework, not a memory server.

## Read first

1. **`.sdd/architecture.md`** — `.sdd`=data / engine=code / LLM=judgment, FCIS, the 7 layers,
   the verdict contract, and the measured `claude -p` invocation.
2. **`.sdd/constitution.md`** — governance and the seven non-negotiables.
3. **`.sdd/triage-rules.md`** — which discipline a change earns. Read BEFORE editing.
4. **`.sdd/memory/decisions/`** — ADRs 0001–0008. Read the file, not a summary.
5. **`docs/PARALLEL.md`** + **`.sdd/lanes.yaml`** — if you are a crewmate in a lane.

## The commands

| | |
|---|---|
| `wst status` | repo, `.sdd/`, judge-adapter health, version drift |
| `wst check` | the check registry; refuses to load an uncalibrated blocking lens |
| `wst triage` | classify a diff → tier → which checks apply |
| `wst gate` | run the checks, skip what receipts prove unchanged, pass or block |
| `wst run <task>` | dispatch a crewmate in an isolated worktree, then gate its work |
| `wst retro` | cluster signals → propose rule changes → **never applies them** |
| `wst init` | interview a repo and generate its `.sdd/` |

## Where things live

| Path | What |
|---|---|
| `.sdd/` | The definition layer. Source of truth. |
| `.sdd/checks/` · `lanes.yaml` · `triage.yaml` | Registry, lane ownership, triage rules |
| `.sdd/memory/` | ADRs, `signals.jsonl`, `retro-log.md`, `proposals/` |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy driving ports passed as PARAMETERS (retry, sequencing) |
| `src/shell/` | Thin adapters: git, fs, claude, crewmate, treehouse, github, sdd |
| `scripts/calibrate.ts` | The calibration harness — ADR-0008's kill criterion |
| `docs/woz/` | Wizard-of-Oz reference specs. Not current procedure. |
| `.claude/hooks/` | Emitter output compiled from `.sdd/`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`** — enforced by the SCHEMA. An `agent-lens` check
   declaring `severity: block` without a passing calibration receipt will not load.
3. **Only a real check failure may block.** A check that could not RUN (spawn, budget, timeout,
   auth, invalid output) is the gate being broken, not a verdict. Never merge the two.
4. **Strict tier = full TDD, RED first** — `src/core/**` and anything propagating to
   bootstrapped projects.
5. **Lane boundaries are enforced, not requested.** `lane-guard.mjs` DENIES out-of-lane writes.
   If it blocks you, the split is wrong — say so rather than working around it.
6. **Decisions change by ADR**, never by editing prose elsewhere (ADR-0007).
7. **The payload must be self-contained.** Anything `init` writes into a target repo may not
   reference Whetstone's own files — it dangles there (ADR-0004). Enforced by a reference-closure
   check that refuses to emit a plan naming a path it does not create.
8. **Ground API claims against the docs before writing code** — prefer Context7. Four signals so
   far are unverified assumptions that shipped or nearly did.
9. **Judge = hermetic, crewmate = charged.** `shell/claude.ts` strips the target repo's MCP,
   hooks and `AGENTS.md` so a repo cannot hijack its own reviewer. `shell/crewmate.ts` loads
   them deliberately — `.sdd/` IS the charter. Backwards in either direction is a serious bug.

## Memory

Backend is `files`; `.sdd/memory/` is the source of truth, human-gated. **Engram namespace is
`whetstone`.** Never save Whetstone work under `chytapay-workspace`.

## Status — Steps 0,1,2,3,5,6,7 done · branch `engine-skeleton`

ADR-0008 records the pivot from Wizard-of-Oz to a TS engine, discharging ADR-0004 for
`init`/`retro` and **explicitly waiving** it for the gate, registry, triage and PR annotation.
Expect rework there.

- **449 tests**, no network, no token cost. `npm test` · `npm run typecheck` · `npm run calibrate`.
- **The loop is closed and self-hosting.** `wst gate` verifies this repo's own changes;
  `wst run` dispatched a crewmate whose work was gated before a human saw it; `wst retro`
  processed 16 signals and produced four amendments, each carrying the signals that earned it.
- **21 signals**, 8 with `resolved_by` back-pointers. Retro N=2.
- **`correctness`** is an agent-lens at `warn`, calibration `uncalibrated` at lens v4. It may
  not block until re-measured unfiltered.

**Open:** Step 4 (annotated PR) · the gate runs only when invoked — no pre-push hook or CI yet ·
ADR-0006's updater has no home in the roadmap · lens v4 needs calibrating.
