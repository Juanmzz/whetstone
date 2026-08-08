# Calibration result — correctness lens

ADR-0008's pre-registered kill criterion, measured at Step 0 before any gate exists.

**The bar (recorded before the first run):** correct AND unanimous — N/N on a known-good AND a
known-bad fixture, zero flips. Anything less is capped at `warn`/`annotate`.

## 2026-08-07

| | claude | model | runs | known-bad | known-good | cost |
|---|---|---|---|---|---|---|
| run 1 | 2.1.225 | sonnet | 10 | 10/10 `fail` | 10/10 `pass` | $0.79 |

**PASS.** Zero flips on either fixture. The assumption the whole design rests on — that an
`agent-lens` verdict can be stable enough to gate on — survives its first test.

## What this does NOT prove

Recorded so the result is not overclaimed later:

- **The fixtures are easy.** They are mirror images of each other: removing versus adding a null
  check before a dereference. Unambiguous by construction.
- **A gate lives on borderline diffs**, not obvious ones. Stability on the easy case says little
  about stability where a reviewer would genuinely hesitate.
- **One lens, one model, one day.** `claude` auto-updates (it moved 2.1.224 → 2.1.225 during this
  very session), so this is a point-in-time measurement. `wst status` warns on version drift for
  exactly that reason.

**Owed before any lens ships as `severity: block`:** harder fixtures — a subtly wrong concurrency
fix, an off-by-one at a boundary, a change that is correct but looks wrong. If a lens flips there,
it is capped at `warn`, and that is the system working, not failing.
