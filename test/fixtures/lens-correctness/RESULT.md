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

---

## 2026-08-08 (later) — lens v3, contract-justification. Better, still FAIL.

Two changes since the run above, so this measures both at once:

1. **The lens now demands a concrete failing input.** v2 asked "does this introduce a bug?"
   and got ~20% false positives on correct code. v3 requires identifying the change's
   stated contract (doc comment, signature, error semantics) and naming a concrete input,
   value, or interleaving that produces observably wrong behaviour — otherwise the verdict
   is `pass`. It also names what is explicitly NOT a bug: an equivalent idiom, a permitted
   loosening, a style you would not have chosen.
2. **The adapter stops discarding correct verdicts** (sig-0008) — trailing tool-call markup
   is stripped rather than rejected.

The harness now READS the lens from `.sdd/checks/correctness.md` instead of keeping its own
copy. The old "must stay in sync" comment was a receipt-integrity hole: on drift you
calibrate one lens and ship another, and the `calibration:` block vouches for text that
never ran.

`npm run calibrate -- --runs 5`, unfiltered, claude 2.1.225, sonnet. **$4.08 / 50 calls.**

| fixture | expect | correct | vs v2 |
|---|---|---|---|
| `known-bad` / `known-good` (easy) | — | 5/5 · 5/5 | held |
| `swallow-bad` / `swallow-good` (medium) | — | 5/5 · 5/5 | held |
| `nullish-bad` (hard) | fail | 5/5 | held |
| `nullish-good` (hard) | pass | **5/5** | **fixed** — was 8/10 |
| `race-bad` (hard) | fail | **5/5** | **fixed** — was 5/10 with 5 blind |
| `race-good` (hard) | pass | **4/5** | improved (was 7/9) — **still flips** |
| `boundary-bad` (hard) | fail | **5/5** | **fixed** — was 6/10 with 4 blind |
| `boundary-good` (hard) | pass | **5/5** | **fixed** — was 7/10 with 3 blind |

### Result — **FAIL. `correctness` stays at `warn`.**

- **Harness: solved.** 0/50 blind, down from 13/80.
- **False negatives: still zero.** All five `-bad` fixtures 5/5. Tightening the burden of
  proof for `fail` did NOT make it start missing bugs — the obvious risk of this change,
  and it did not materialise at this N.
- **False positives: nearly gone, not gone.** One flip on `race-good` in five runs. The bar
  is unanimity, and one flip is a flip.

### What this run does NOT prove

- **N=5 is thin.** A single flip in five could be a 20% rate or a 5% rate; this run cannot
  tell them apart. It is enough to fail on, nowhere near enough to pass on.
- **Both changes landed together**, so the split between "better lens" and "adapter no
  longer discarding verdicts" is inferred from which fixtures moved, not isolated.
- **`race-good` remains the hard case** — a `finally`-cleared single-flight refresh. It was
  written as false-positive bait and it is still biting, which is the bait working.

### Next

Do not re-run this lens unchanged; it will fail the same way. The remaining failure is
concentrated in one fixture family (concurrency), which suggests a lens addition about
async/interleaving reasoning specifically, rather than another general rewrite.
