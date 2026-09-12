# Whetstone: agent orientation

> **Keep this file thin.** Per ADR-0002 the content lives in `.wst/` and vendor files render
> from it. If you are about to explain architecture here, put it in `docs/architecture.md` and
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

1. **`docs/architecture.md`** states what is true now: the three parts, the
   loop, the layers, FCIS, the check registry, the measured `claude -p` invocation.
2. **`.wst/constitution.md`**: governance and the seven non-negotiables.
3. **`.wst/triage-rules.md`**: which discipline a change earns. Read BEFORE editing.
4. **`.wst/memory/decisions.md`**: every decision by anchor id, carrying what it ruled out.
   Open it when you are about to change one, not to learn how the system works.
5. **`docs/PARALLEL.md`** + **`docs/lanes.yaml`**, if you are a crewmate in a lane.

## The commands

Three of them are the product. The rest are diagnostics, compatibility, or standby
(adr-0048).

| | |
|---|---|
| `wst init` | interview a repo and write `.wst/`: the checks it can run, and how to route them. Nothing else |
| `wst ready` | **zero arguments.** Resolves what this task changed, runs the checks, answers READY, NOT_READY, INCOMPLETE or NO_CHANGES |
| `wst status` | repo, `.wst/`, judge health, version drift, whether the push gate is armed |
| `wst` | with no arguments and in a terminal: a four-row launcher over those three, plus a diagnostics drawer. Off a terminal, the help |

**Diagnostic**, for agents and maintainers, behind one key in the launcher:

| | |
|---|---|
| `wst triage` | classify a change → tier → which checks apply. Runs none of them |
| `wst check` | the check registry; refuses to load an uncalibrated blocking lens. `check run <id>` runs one whose logic ships with `wst` |

**Compatibility**: `wst gate` runs the checks over a range somebody passes. `ready` reuses
its engine and resolves the range itself; the hook and CI still name `gate`.

**Standby**, off the product path and still working: `wst signal` (it IS the [RC3] gate,
for a human to type), `wst retro` (clusters signals, proposes, never applies), `wst update`
(reports what drifted since `init`).

**Deleted**: `wst config`. It edited four keys an agent edits directly.

Useful flags: `ready --json` (an envelope with a semantic `result` field) · `ready --range`
(an override for CI and diagnostics) · `gate --no-lens` · `gate --fast` · `gate --no-emit`.

## Where things live

| Path | What |
|---|---|
| `.wst/` | The definition layer. Source of truth. |
| `.wst/checks/` · `lanes.yaml` · `triage.yaml` | Registry, lane ownership, triage rules |
| `.wst/memory/` | `decisions.md`, `signals.jsonl`, `retro-log.md`; `proposals/` holds a retro's draft until the log records it |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy driving ports passed as PARAMETERS (retry, sequencing) |
| `src/shell/` | Thin adapters: git, claude, sdd, signals, events, receipts, plugin |
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
## Status: branch `main` · 48 ADRs · 66 signals · 10 commands

ADR-0008 records the pivot from Wizard-of-Oz to a TS engine, discharging ADR-0004 for
`init`/`retro` and **explicitly waiving** it for the gate, registry and triage. PR annotation was
built under that waiver and removed by ADR-0009.

- **The loop is closed and self-hosting.** `wst gate` verifies this repo's own changes and
  writes its own signals; `wst retro` has run four times, producing amendments across seven of
  the eight skills, each carrying the signals that earned it. Enforcement on any worker's
  changes is the push and CI: the pre-push hook is armed (`core.hooksPath=.githooks`) and CI
  runs the full gate on every PR. ADR-0023 cut `plan` and `prepare`; what a worker needs to
  know is in `.wst/`, which it can already read.
- **61 signals**, 27 with `resolved_by`. Four retros. Seven of eight skills amended:
  `tdd-discipline` v7, `delegation` v4, `xreview` v3, `doc-locations` v4, `voice` v2,
  `recording` v2, `lazy` v2. Only `token-economy` is still at v1.
- **`correctness` does NOT block.** Measured 2026-08-25 on claude 2.1.245: 100/100, unanimous
  on all ten fixtures, zero harness errors, $2.97. adr-0027 promoted it on that. The receipt
  records `model: sonnet`, and the check is `tiers: [strict]`, which routes to `opus`: its
  authority came from a measurement of a judge it never runs under. adr-0045 binds the model
  and the block lapsed on 2026-08-30. The receipt binds the prompt, the fixtures and the
  model; the runtime version is recorded and reported as drift, not enforced. adr-0047
  adds the other way back: a `signed_block` grants it on the owner's judgement instead,
  and `wst check` prints `BLOCK*` so the two bases are never read as one.

### Known weaknesses, stated plainly

- **Most signals are still hand-authored.** Of 61: 45 predate the `source` field, 8 are `cli`,
  2 are `human`, and **6 were written by the gate about its own blocks**. The first was
  `sig-a9ff00c4` on 2026-08-14, when `docs-fresh` blocked a change that added an ADR and left
  this line behind. Before that, CI emitted one on an ephemeral runner and it evaporated: the
  gap was never "the gate does not fail", it was that where the gate really runs, nothing
  persisted what it observed.
  The machine-written six are the loop's only input nobody had to remember to type, and
  that number is the one to watch.
- **Nothing blocks on judgement right now.** `correctness` never fired: the promoting change
  touched no `src/**/*.ts`, so the lens did not run in its own CI, and adr-0045 then found the
  measurement described the wrong model. One `calibrate` run against `opus` restores it.
- **Mutation score 85%** over a 40-mutation sample; the suite catches real bugs but the sample
  was small.
- **Unowned:** `npm run check:in-force` lists what is decided and not yet true of the
  code, so this line no longer keeps it by hand. Beyond that: no skill owns
  subprocess-exit-code conventions (a retro proposal was declined for want of a home);
  **eight of the thirteen checks are Whetstone-only**: `adr-refs`, `command-surface`, `docs-fresh`,
  `in-force`, `provenance`, `run-the-lens`, `skill-shape` and `strict-tdd` enforce this repo's own discipline, `init` seeds none of them, and
  nobody has asked what each last caught; and nothing says what the signal log does after two
  years of appending. **`commit-message` is the first check whose subject is not a file**, and
  the registry has no way to express that: selection is by changed path, so its `include` is
  made broad here and scoped to the declared layout where `init` writes it, which means a
  documentation-only commit escapes it in a bootstrapped repo.
