---
id: adr-0008
ts: 2026-08-07
status: accepted
supersedes: null
amends: adr-0004          # partial waiver — see "A note on the status vocabulary"
rules_affected: ["triage-rules.md"]
---
# Build the TS engine now — discharging ADR-0004 for the retro, waiving it for the gate

## Context

Whetstone was deliberately built with no code. [[0004-packaging-roadmap-installer-not-value]] fixed
the order — **Wizard-of-Oz → validate by dogfooding → then wrap** — and `CLAUDE.md` carried the
operational form of it: *"Do NOT build a CLI/plugin or distribution before the retro is repeatable
(N>1)."* That rule existed to prevent `sig-0001`'s error: building ahead of validation.

Two things have changed.

**The retro was validated once.** Dogfooded on the Two Way Invoice Sync take-home, `retro.md` produced
TD6 — a rule a human actually wanted to accept. That is precisely the pre-registered kill criterion in
[[0003-positioning-human-gated-not-autonomous]], and it passed. N=1, not N>1: the thesis survived, it
was not shown repeatable.

**The design moved past what markdown can express.** `_design/WHETSTONE-DESIGN.md` settles Whetstone as
an *engine* — `.sdd/` as declarative data, deterministic code doing triage/selection/gating/receipts,
and the LLM called only where judgment is irreducible. A markdown procedure cannot enforce a gate,
hash a receipt, or refuse to block on a flaky verdict. The WoZ substrate is now the binding constraint.

**The honest problem with pivoting.** ADR-0004's ordering was discharged only for what was actually
Wizard-of-Oz'd: `init.md` and `retro.md` — Steps 6 and 7 of the build plan. Steps 1–5 (check registry,
triage routing, lean gate, receipts, annotated PR, dispatch) were **never** run by hand and never
validated. Building them is net-new product surface wearing the old surface's validation. Calling
ADR-0004 "satisfied" would be true for the wrapper and false for most of what gets built.

Alternatives weighed:
- **Wait for N>1 retros before any code.** Rejected: the second retro needs signal volume, and signal
  volume needs the loop running against real work — which the WoZ procedure makes too expensive to run
  often. The rule would be self-perpetuating.
- **Wrap only the validated parts** (`wst init`, `wst retro`) and leave the gate as markdown. Rejected:
  the gate is the differentiator (Layer 4/5); shipping the commodity half first inverts the value.
- **Build everything, declare ADR-0004 satisfied.** Rejected: that is the silent supersession
  [[0007-adrs-are-retro-amendable-via-status-flip]] exists to forbid.

## Decision

1. **Build the engine, sanctioned by [[0005-emitter-is-a-compiler-code-tier-is-v1]], not by 0004.**
   ADR-0005 already places the code tier in V1 and names the CLI as the surface. That is the standing
   authority for writing code; ADR-0004's *ordering* is a separate question, handled next.

2. **ADR-0004 is discharged for Steps 6–7 and explicitly WAIVED for Steps 1–5.** Named, not implied.
   The gate, registry, triage, receipts and PR annotation are being built against a *design*, not
   against a validated procedure. We accept that risk deliberately and pay for it in point 4.

3. **`CLAUDE.md`'s "no CLI before N>1" rule is retired.** It was a note, never an ADR. Its concern —
   don't build ahead of validation — is preserved by the kill criterion below rather than by a ban.

4. **Pre-registered kill criterion for the engine.** The whole thesis rests on one unmeasured
   assumption: that an `agent-lens` verdict can be stable enough to gate on. The test, run at Step 0
   before any gate exists:

   > One real lens, one known-good and one known-bad fixture, **N=10 runs each**. To earn `block`, a
   > lens must be **correct and unanimous: 10/10 on both fixtures, zero flips.** Anything less is
   > capped at `warn`/`annotate`.

   Stability alone is not the bar — a lens that stably passes everything is stable and worthless, so
   correctness on the known-bad fixture is required. **If no lens can clear this bar**, the gate
   degrades to deterministic checks only, which is commodity CI that every team already has, and the
   differentiator is gone. In that case: stop and reconsider before building Steps 4–7. Recorded now
   so the threshold cannot be fitted to the result afterward.

5. **Whetstone is an end-to-end conductor.** This reverses `VISION.md`'s "not an orchestrator" line and
   is stated here rather than edited quietly into a doc. The reconciliation: Whetstone takes *light*
   orchestration — triage, plan gate, fan-out, gate, PR — and delegates everything commodity
   (worktrees to treehouse, GitHub to gh, execution and judgment to `claude`). It does not do fleet
   management. **The anti-scope that still stands unchanged:** not a spec framework, not a memory
   server. Those remain policy.

6. **Two constitution non-negotiables originate here**, since they are decisions with real
   alternatives, not house style:
   - **Determinism by default** — the LLM is called only for irreducible judgment; `core/` never calls
     an LLM. Enforced by the import boundary, not by discipline. The alternative (trust the prompt)
     is what makes agent tooling unreproducible.
   - **A judgment check earns its `block`** — deterministic checks may block freely; an `agent-lens`
     check may block only after passing point 4's calibration.

7. **`triage-rules.md` regains its full-TDD meaning.** The file's own note deferred `strict` discipline
   "until the emitter becomes code." It has. `strict` now covers `src/core/**`.

### A note on the status vocabulary

[[0007-adrs-are-retro-amendable-via-status-flip]] gives ADRs `proposed → accepted → superseded`. This
decision is a **partial** waiver: ADR-0004's reasoning stays correct, only its applicability narrows.
There is no status for that, and flipping 0004 to `superseded` would be a lie. So this ADR introduces
`amends` / `amended_by` frontmatter alongside the status flip. ADR-0004 keeps `status: accepted`, gains
`amended_by: adr-0008` and a pointer banner — metadata added, accepted prose untouched, per ADR-0007.

## Consequences

- **Easier:** the gate, receipts and annotation become buildable; `.sdd/` stops being advisory.
- **Harder:** Steps 1–5 have no validated procedure behind them. Expect rework, and expect the
  calibration result (point 4) to force it.
- **The WoZ artifacts are not discarded.** `init.md`, `retro.md` and `SPEC.md` move to `docs/woz/`,
  tracked, as the working specification for Steps 1, 6 and 7.
- **Reversal condition:** point 4's calibration failing is the named trigger to stop and reconsider.

### Open, and deliberately unowned

Named here so they cannot be lost by omission — each needs its own decision later:

1. **[[0006-update-model-3way-merge-via-git]] has no home in Steps 0–7.** The updater was the previous
   next-step, and the take-home was to be its test case. The engine roadmap does not contain it. The
   one real downstream project currently has no upgrade path.
2. **The v0.3 payload (8 skills, `retro.md`) has no port path.** Is the engine a *replacement* for the
   payload, or a *runtime* that executes it? Unanswered, and it changes what Step 6 builds.
3. **The build sequence may be wrong.** An adversarial review argued Steps 0–2 are horizontal
   foundation and that a thin vertical slice (`git diff → one lens → calibrate → annotate`) would test
   the thesis sooner. Not adopted — it re-plans the whole build — but recorded rather than dropped.
   Point 4's calibration spike is the cheap part of that argument, and it *is* adopted.
4. **No git remote, and `gh-axi` is not installed.** Both are required by Steps 4–5. Unowned.
5. **Signal volume is thin** (2 signals in this repo). Step 7's anti-poisoning gate requires
   multi-source clusters, so the retro is undernourished by construction until the gate emits signals.
