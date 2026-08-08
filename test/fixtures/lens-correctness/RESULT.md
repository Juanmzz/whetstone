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

### What the 2026-08-07 run does NOT prove

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

---

## 2026-08-08 — the hard fixtures land, and the lens does NOT clear the bar

The debt above is paid: 8 new fixtures (4 pairs) where a competent reviewer would hesitate, each
with a one-sentence ground truth recorded in `manifest.json` *before* the run. The harness now
discovers every `.diff` in this directory and refuses to run if one is undeclared, so a fixture can
no longer be silently skipped.

`npm run calibrate -- --runs 5` (5, not 10, to bound cost), then a second confirmation pass over the
three families that misbehaved. `claude 2.1.225`, sonnet.

### Result — **FAIL. `correctness` stays at `warn`.**

Aggregated over both passes. "no verdict" = the run never produced a parseable verdict, i.e. all 3
attempts came back contaminated with tool-call markup — the *harness* failing, not the lens judging
wrongly. The two are counted separately here on purpose; conflating them is the exact line
`core/llm/verdict.ts` draws and the gate must keep.

| fixture | expect | N | correct | no verdict | flips |
|---|---|---|---|---|---|
| `known-bad.diff` (easy) | fail | 5 | 5/5 | 0 | — |
| `known-good.diff` (easy) | pass | 5 | 5/5 | 0 | — |
| `swallow-bad.diff` (medium) | fail | 5 | 5/5 | 0 | — |
| `swallow-good.diff` (medium) | pass | 5 | 5/5 | 0 | — |
| `nullish-bad.diff` (hard) | fail | 10 | 10/10 | 0 | — |
| `nullish-good.diff` (hard) | pass | 10 | 8/10 | 0 | **2 × `fail`** |
| `race-bad.diff` (hard) | fail | 10 | 5/10 | **5** | — (5/5 decided correct) |
| `race-good.diff` (hard) | pass | 10 | 7/10 | 1 | **2 × `fail`** |
| `boundary-bad.diff` (hard) | fail | 10 | 6/10 | **4** | — (6/6 decided correct) |
| `boundary-good.diff` (hard) | pass | 10 | 7/10 | 3 | — (7/7 decided correct) |

Cost: **$4.86** for the 50-call primary pass, **$4.18** for the 30-call confirmation pass. The
per-call cost is ~2.5× the 2026-08-07 run because every contaminated attempt is retried three times
and every attempt is billed.

### The two findings, kept apart

**1. The lens produces FALSE POSITIVES on borderline-correct diffs — never false negatives.**
Every verdict it managed to return on a `-bad` fixture was `fail`: **31/31**. It did not miss a
single planted bug, including the two hard ones. But on correct code it flipped twice — 2/10 on
`nullish-good` (calling the idiomatic `== null` widening a bug) and 2/9 on `race-good` (calling a
correct `finally`-cleared single-flight refresh a bug). Roughly a **20% false-positive rate on
borderline-correct diffs.**

This is the worst possible shape for a gate. A check that cries wolf on correct work is the thing
users route around, and once it is routed around its value is negative — which is precisely why
ADR-0008 pre-registered unanimity rather than accuracy. The lens is a good *annotator* and not yet
a gate.

**2. The harness cannot get a verdict at all on ~16% of runs, and it is size-correlated.**
13 of 80 runs returned no verdict — 12 of them `invalid-output` from
`structured_output is contaminated with tool-call markup (</parameter>)` on all three attempts, plus
one `spawn` failure. The distribution is not random: **zero** errors across 40 runs of the six short
fixtures (`known-*`, `swallow-*`, `nullish-*`, all ≤10 diff lines) and **13 errors across the 40
runs** of the four long ones (`race-*`, `boundary-*`, 11–15 diff lines) — a 33% blind rate on the
longer inputs alone. The contamination that
`.sdd/architecture.md` records as fixed by `--append-system-prompt` is not fixed — it is merely rare
on short inputs, and a real gate reviews diffs far longer than 15 lines.

This is an adapter defect (`src/shell/claude.ts` / `src/core/llm/verdict.ts`), not a fixture problem
and not a judgment problem. It is the *larger* of the two blockers: no promotion policy matters if a
third of invocations on realistic-length diffs cannot answer at all.

### What this run does NOT prove

- **N is still small.** 5–10 runs per fixture, one model, one day. It is enough to fail on, not
  enough to pass on: a fixture at 10/10 here has nothing like the evidence a `block` needs.
- **10 fixtures is not a corpus.** They are hand-written by one author, and the "hard" label is that
  author's judgment. `nullish-good` and `race-good` were written *as* false-positive bait and they
  caught exactly what they were built to catch — which is confirmation the bait works, not a
  measurement of the real-world false-positive rate.
- **The under-sampled cells are the important ones.** `race-bad` produced only 5 usable verdicts out
  of 10 and `boundary-bad` only 6. Both were unanimous on what they did return, but the sample is
  thin *because* of finding 2, so "no flip observed" there is weak evidence, not a clean sheet.

### Recommendation (the gate policy decision belongs to the orchestrator, not to this lane)

- **`correctness` stays `severity: warn`.** It is not marginally short of the bar; it fails on the
  failure mode the bar exists to catch.
- **Fix the contamination before re-measuring.** Re-running the calibration against a harness that
  is blind on a third of realistic-length diffs measures the adapter, not the lens.
- **Re-measuring is only worth it after the lens changes.** The same lens on the same fixtures will
  fail the same way. A lens that must justify a `fail` against the change's stated contract — the
  doc comment both false positives ignored — is the cheapest thing to try next.

No fixture was altered after seeing a verdict. ADR-0008 pre-registers against exactly that, and the
two fixtures the lens got wrong are the two most likely to tempt it.
