# Whetstone — agent orientation

> **Keep this file thin.** Per ADR-0002 the content lives in `.sdd/` and vendor files render
> from it. If you are about to explain architecture here, put it in `.sdd/architecture.md` and
> link instead.
>
> ⚠ This file has gone stale four times. That is structural, not careless: a hand-maintained
> vendor file drifts the moment work outpaces documentation. `wst init` already generates this
> artifact for target repos, so making Whetstone's own copy emitter output is the obvious next
> step. **Until then, `.sdd/` is authoritative wherever the two disagree.**

Whetstone is a **self-sharpening standards layer** for AI coding agents. It captures a
project's definition of *correct* as plain files in git, enforces it with a deterministic
engine that calls an LLM only where judgment is irreducible, and grows the checks a project
needs from the friction it actually hits. Not a spec framework, not a memory server.

## Read first

1. **`.sdd/architecture.md`** — `.sdd`=data / engine=code / LLM=judgment, FCIS, the 7 layers,
   the verdict contract, the measured `claude -p` invocation.
2. **`.sdd/constitution.md`** — governance and the seven non-negotiables.
3. **`.sdd/triage-rules.md`** — which discipline a change earns. Read BEFORE editing.
4. **`.sdd/memory/decisions/`** — ADRs 0001–0008. Read the file, not a summary.
5. **`docs/PARALLEL.md`** + **`.sdd/lanes.yaml`** — if you are a crewmate in a lane.

## The commands

| | |
|---|---|
| `wst status` | repo, `.sdd/`, judge health, version drift, whether the pre-push gate is armed |
| `wst check` | the check registry; refuses to load an uncalibrated blocking lens |
| `wst triage` | classify a diff → tier → which checks apply |
| `wst gate` | run the checks, skip what receipts prove unchanged, pass or block, emit signals |
| `wst run <task>` | dispatch a crewmate in an isolated worktree, then gate its work |
| `wst signal` | record an observation in `signals.jsonl`. **For the human to type** — it IS the [RC3] gate; an agent still proposes and waits |
| `wst retro` | cluster signals → propose rule changes → **never applies them** |
| `wst init` | interview a repo and generate its `.sdd/` |

Useful flags: `gate --no-lens` (fast, free, what the hook runs) · `gate --no-emit` (do not
record signals; for when you are testing the gate itself) · `run --dry-run` · `retro --dry-run`.

## Where things live

| Path | What |
|---|---|
| `.sdd/` | The definition layer. Source of truth. |
| `.sdd/checks/` · `lanes.yaml` · `triage.yaml` | Registry, lane ownership, triage rules |
| `.sdd/memory/` | ADRs, `signals.jsonl`, `retro-log.md`, `proposals/` |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy driving ports passed as PARAMETERS (retry, sequencing) |
| `src/shell/` | Thin adapters: git, fs, claude, crewmate, treehouse, github, sdd, signals |
| `scripts/calibrate.ts` · `scripts/mutate.ts` | Lens calibration · mutation testing |
| `.githooks/pre-push` · `.github/workflows/gate.yml` | Where the gate actually runs |
| `docs/woz/` | Wizard-of-Oz reference specs. Not current procedure. |
| `.claude/hooks/` | Emitter output compiled from `.sdd/`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`** — enforced by the SCHEMA. An `agent-lens` declaring
   `severity: block` without a passing calibration receipt will not load.
3. **Only a real check failure may block.** A check that could not RUN (spawn, budget, timeout,
   auth, invalid output) is the gate being broken, not a verdict. Never merge the two, and never
   let "no checks ran" share a message with "all checks passed".
4. **Strict tier = full TDD, RED first** — `src/core/**` and anything propagating to
   bootstrapped projects.
5. **Lane boundaries are enforced, not requested.** `lane-guard.mjs` DENIES out-of-lane writes.
   If it blocks you, the split is wrong — say so rather than working around it.
6. **Decisions change by ADR** (ADR-0007). Accepted prose is never rewritten.
7. **The payload must be self-contained.** Anything `init` writes into a target repo may not
   reference Whetstone's own files — it dangles there (ADR-0004). Enforced by a reference-closure
   check that refuses to emit a plan naming a path it does not create.
8. **Ground API claims against the docs before writing code** — prefer Context7.
9. **Judge = hermetic, crewmate = charged.** `shell/claude.ts` strips the target repo's MCP,
   hooks and `AGENTS.md` so a repo cannot hijack its own reviewer. `shell/crewmate.ts` loads them
   deliberately: `.sdd/` IS the charter. Backwards in either direction is a serious bug. A
   hermetic judge cannot resolve a path, so everything it must judge is inlined (delegation D7).
10. **Isolate a negative control.** When you break something on purpose to prove a check catches
    it, that defect must be the ONLY uncommitted change, and use `--no-emit`. Twice now it has
    contaminated something else: real work (`sig-0025`) and the evidence log (`sig-0026`).

## Memory

Backend is `files`; `.sdd/memory/` is the source of truth, human-gated. **Engram namespace is
`whetstone`.** Never save Whetstone work under `chytapay-workspace`.

## Status — Steps 0–7 complete · branch `engine-skeleton` · 581 tests

ADR-0008 records the pivot from Wizard-of-Oz to a TS engine, discharging ADR-0004 for
`init`/`retro` and **explicitly waiving** it for the gate, registry and triage. PR annotation was
built under that waiver and removed by ADR-0009.

- **The loop is closed and self-hosting.** `wst gate` verifies this repo's own changes and now
  writes its own signals; `wst run` dispatched a crewmate whose work was gated before a human saw
  it; `wst retro` has run twice, producing six amendments across four skills, each carrying the
  signals that earned it. The pre-push hook is armed (`core.hooksPath=.githooks`) and CI runs the
  full gate on every PR.
- **26 signals**, 13 with `resolved_by`. Two retros. Four skills amended: `tdd-discipline` v3,
  `xreview` v3, `delegation` v3, `voice` v2.
- **`correctness`** is an agent-lens at `warn`, `uncalibrated` at lens v4. It may not block until
  re-measured unfiltered. v3 failed the bar on false positives, which is the system working.

### Known weaknesses, stated plainly

- **Every signal in the log is still hand-authored.** The emitter exists and is verified, but it
  has recorded nothing real yet, so the evidence the retro reasons over remains an agent's diary
  with good formatting. That improves only as the gate runs on real failures.
- **The lens is uncalibrated at v4**, so the differentiator is advisory.
- **Mutation score 85%** over a 40-mutation sample; the suite catches real bugs but the sample
  was small.
- **Unowned:** ADR-0006's updater has no home in the roadmap; no skill owns subprocess-exit-code
  conventions (a retro proposal was declined for want of a home).
