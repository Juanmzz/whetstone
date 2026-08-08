# Whetstone — agent orientation

> Hand-seeded pre-wizard. Eventually `wst init` generates this; for now it is maintained by hand so
> the project dogfoods itself. **Keep this file thin.** Per ADR-0002 the content lives in `.sdd/`
> and vendor files are rendered from it — if you are about to explain architecture here, put it in
> `.sdd/architecture.md` and link instead.

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

## Where things live

| Path | What |
|---|---|
| `.sdd/` | The definition layer — config, governance, memory, skills. Source of truth. |
| `src/core/` | Pure deterministic engine. **Never imports `src/shell/`.** |
| `src/shell/` | Thin adapters: git, fs, exec, claude. |
| `docs/woz/` | Wizard-of-Oz era reference specs — the spec for Steps 1/6/7. Not current procedure. |
| `_design/` | Untracked working material (drafts, research). Not the product. |
| `.claude/hooks/` | Emitter output, compiled from `.sdd/triage-rules.md`. Hand-edits are drift. |

## Hard rules

1. **`core/` never imports `shell/`,** and never calls an LLM. Enforced by `test/architecture.test.ts`.
2. **A judgment check earns its `block`.** Deterministic checks may block freely; an `agent-lens`
   check may block only after passing calibration (10/10 on known-good AND known-bad, zero flips).
3. **Strict tier = full TDD, RED first.** `src/core/**` and anything propagating to bootstrapped
   projects. See `.sdd/triage-rules.md`.
4. **Decisions change by ADR, never by editing prose elsewhere.** Accepted ADR text is never
   rewritten (ADR-0007); supersede or amend it with a new one.
5. **The payload must be self-contained.** Anything copied into a target repo (skills, schemas) may
   not reference Whetstone's own files — it will dangle there (ADR-0004).
6. **Do not simplify the `claude -p` flag set.** Every flag was measured; see `.sdd/architecture.md`.

## Memory

Backend is `files` (`.sdd/wst.yaml`) — `.sdd/memory/` is the source of truth, human-gated.
**Engram namespace for this repo is `whetstone`.** Never save Whetstone work under
`chytapay-workspace`; if you see ChytaPay context injected here, ignore it (stale plugin cache).

## Status — Step 0 (engine skeleton), branch `engine-skeleton`

The Wizard-of-Oz era is over: ADR-0008 records the pivot to a TS engine, discharging ADR-0004 for
`init`/`retro` (validated in the wild — the retro produced TD6) and **explicitly waiving** it for the
gate, registry, triage, receipts and PR annotation, which are built against a design and not yet
validated. Expect rework there.

- **8 skills** active (`.sdd/wst.yaml`), `tdd-discipline` at v2 (TD6 — the first earned receipt).
- **2 signals** logged. Thin — Step 3 is what starts feeding the retro.
- **Next:** finish Step 0, then the calibration spike. Its result gates whether Steps 4–7 keep
  their current shape (ADR-0008's kill criterion).

**Unowned, named so they are not lost:** ADR-0006's updater has no home in Steps 0–7 · the v0.3
payload has no port path · no git remote and `gh-axi` is not installed (needed by Steps 4–5).
