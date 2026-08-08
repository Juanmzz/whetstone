# Whetstone — agent orientation

> Hand-seeded pre-wizard. Eventually `wst init` generates this; for now it is maintained by hand so
> the project dogfoods itself. **Keep this file thin.** Per ADR-0002 the content lives in `.sdd/`
> and vendor files are rendered from it — if you are about to explain architecture here, put it in
> `.sdd/architecture.md` and link instead.
>
> ⚠ This file went stale within a single session (it claimed "2 signals" while 7 were logged). That
> is evidence for ADR-0002/0006: it should be COMPILED from `.sdd/`, not hand-maintained. Until the
> emitter exists, treat `.sdd/` as authoritative wherever the two disagree.

Whetstone is a **self-sharpening standards layer** for AI coding agents: installed per project,
versioned as plain files in git. It captures a project's definition of *correct*, drives a workflow
calibrated to each change's criticality, and ends every task in a PR annotated with **where a human
should actually look**. It is not a spec framework and not a memory server.

## Read first

1. **`.sdd/architecture.md`** — how it is built: `.sdd`=data / engine=code / LLM=judgment, the FCIS
   split, the 7 layers, the LLM verdict contract, the validated `claude -p` invocation.
2. **`.sdd/constitution.md`** — governance and the non-negotiables.
3. **`.sdd/triage-rules.md`** — which discipline a change gets. Read BEFORE editing.
4. **`.sdd/memory/decisions/`** — ADRs 0001–0008. Read the file, not a summary.
5. **`docs/PARALLEL.md`** — if you are a crewmate in a lane, this is your brief.

## Where things live

| Path | What |
|---|---|
| `.sdd/` | The definition layer — source of truth. |
| `.sdd/checks/` | The check registry, one file per check. `_index.json` is a regenerable cache. |
| `.sdd/lanes.yaml` | Lane ownership for parallel work. Compiled into `.claude/hooks/lane-guard.mjs`. |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/core/orchestrate/` | Policy that drives ports passed as parameters (retry, sequencing). |
| `src/shell/` | Thin adapters: git, fs, exec, claude, sdd. |
| `scripts/calibrate.ts` | The calibration harness — ADR-0008's kill criterion. |
| `docs/woz/` | Wizard-of-Oz reference specs — the spec for Steps 1/6/7. Not current procedure. |
| `_design/` | Untracked working material. Not the product. |
| `.claude/hooks/` | Emitter output, compiled from `.sdd/`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`.** Enforced by the SCHEMA, not at run time: an `agent-lens`
   check declaring `severity: block` without a passing calibration receipt is refused by the loader.
3. **Strict tier = full TDD, RED first.** `src/core/**` and anything propagating to bootstrapped
   projects. See `.sdd/triage-rules.md`.
4. **Lane boundaries are enforced, not requested.** `.claude/hooks/lane-guard.mjs` DENIES writes
   outside your lane when `.wst-lane` or `WST_LANE` is set. If you hit it, the split is wrong — say
   so rather than working around it.
5. **Decisions change by ADR, never by editing prose elsewhere.** Accepted ADR text is never
   rewritten (ADR-0007); supersede or amend it with a new one.
6. **The payload must be self-contained.** Anything copied into a target repo (skills, schemas) may
   not reference Whetstone's own files — it will dangle there (ADR-0004).
7. **Do not simplify the `claude -p` flag set.** Every flag was measured; see `.sdd/architecture.md`.
8. **Ground API claims against the docs before writing code** — prefer Context7 for library/CLI
   docs. Two of this project's signals (`sig-0003`, `sig-0004`) are unverified-API assumptions that
   shipped or nearly shipped.

## Memory

Backend is `files` (`.sdd/wst.yaml`) — `.sdd/memory/` is the source of truth, human-gated.
**Engram namespace for this repo is `whetstone`.** Never save Whetstone work under
`chytapay-workspace`; if you see ChytaPay context injected here, ignore it (stale plugin cache).

## Status — Steps 0 and 1 complete, branch `engine-skeleton`

ADR-0008 records the pivot from Wizard-of-Oz to a TS engine: it discharges ADR-0004 for
`init`/`retro` (validated in the wild — the retro produced TD6) and **explicitly waives** it for the
gate, registry, triage, receipts and PR annotation. Expect rework there.

- **Shipped:** `wst status`, `wst check`. 60 tests, no network, no token cost.
- **Step 0** — FCIS skeleton, the hardened `LlmJudge` port, the `claude` adapter, and the
  calibration harness. The kill criterion PASSED (10/10 unanimous on both fixtures).
- **Step 1** — the check registry. 3 checks seeded: `typecheck`, `test` (block), `correctness`
  (agent-lens, held at `warn` — the fixtures it passed on are too easy to justify blocking).
- **8 skills** active (`.sdd/wst.yaml`), `tdd-discipline` at v2 (TD6 — the first earned receipt).
- **7 signals** logged; `sig-0004`–`0007` came from building the engine, not from the WoZ procedure.
- **Next:** parallel lanes per `docs/PARALLEL.md` — fixtures and receipts first, then triage, then
  the gate. `wst gate` is the checkpoint where Whetstone starts gating its own PRs.

**Unowned, named so they are not lost:** ADR-0006's updater has no home in Steps 0–7 · the v0.3
payload has no port path · no git remote and `gh-axi` is not installed (needed by Steps 4–5) ·
task decomposition (who cuts the lanes) is not owned by any step.
