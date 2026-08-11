---
id: tdd-discipline
version: 3
status: active
---
# TDD discipline

Match the rigor of the test loop to the risk of the change. The change's risk class is set
by the project's triage rules, which operationalize the constitution's risk profile — not
guessed per file.

## Levels

- **strict** — critical paths: RED → GREEN → TRIANGULATE → REFACTOR, full cycle.
- **light** — standard non-critical: one failing happy-path test before implementation.
- **off** — trivial: no tests required; still flag any subtle logic discovered.

Which paths are `strict` is set by the project's triage rules, operationalizing the
constitution's risk profile — not by this skill. A change that touches a strict path uses
strict TDD regardless of how small it looks.

## Rules

1. [TD1] **RED** — failing test BEFORE implementation. Must fail for the right reason (a
   logical assertion, not a compile error). Commit at RED.
2. [TD2] **GREEN** — minimum code to pass. No extras, no cleanup. Commit at GREEN.
3. [TD3] **TRIANGULATE** *(strict only)* — a second test with semantically different data
   (boundary, edge case, alternate path) to kill hardcoded implementations. If it fails,
   return to GREEN.
4. [TD4] **REFACTOR** — clean up with the tests as a safety net. No new behavior; tests stay
   green throughout.
5. [TD5] Test names describe behavior, not implementation.
   - Good: `"returns zero commission when amount is below the minimum threshold"`
   - Bad: `"test processCommission with 0"`
   - Format: `"{subject} {behavior} when {condition}"` or `"given {state}, {subject} {behavior}"`.
6. [TD6] **Exercise the real path, not a convenient fixture.** A test must drive the UNSEEDED
   production path. A fixture seeded for convenience (pre-linked references, a fake pre-set to
   equal the expected state) must not be the *only* path tested, or it masks the exact failure
   the test is meant to guard. Assert a property through its real consumer, not a proxy that can
   pass for the wrong reason (e.g. an equality check that treats `NaN` as equal). Corollary: on
   delegated or generated code, a fresh-context review of the real path is the load-bearing gate
   — agents systematically green-light the happy fixture.
7. [TD7] **A guard is not trusted until it is proven in BOTH directions.** Testing what a
   guard *rejects* proves nothing about what it *accepts*. Every blocking guard, validator or
   filter needs a paired false-positive test: one case it must reject, and one legitimate case
   it must let through. A guard that fails closed on real work is worse than no guard, because
   it gets routed around.
   - **Thresholds are measured, not chosen.** If a guard's rule was inferred from a handful of
     observations, it is a hypothesis. Measure it against a real sample before shipping it as a
     block, and state the sample size next to the claim.
   - **A negative test must prove it landed.** Before trusting "the check blocked it", confirm
     the mutation you introduced actually applied AND that the test went red for the reason you
     intended. A no-op patch produces a green run that looks exactly like a broken guard.

## Defining a strict path (worked example)

The constitution's risk profile names the domains where correctness is non-negotiable; the
project's triage rules turn that into a strict classification, mandatory regardless of how
small the change looks. Example — a payment system's constitution might name money handling
as such a domain:

- integer arithmetic (cents, not floats): `1050` = $10.50, never `10.50`;
- required cases before "done": zero, max-safe-integer edge, negative (refunds/reversals),
  unit/currency mismatch, rounding (name the rule in the test);
- a money function without triangulation is INCOMPLETE.

This is an ILLUSTRATION, not a core rule. Another project's strict path might be auth,
migrations, or a safety-critical calculation. Whetstone does not hard-code the domain — the
project's constitution names it, and the project's triage rules classify changes against it.

## Test infrastructure

Per-project specifics (runner, paths, fakes, fixtures, E2E/golden paths) live in the
project's own config (`CLAUDE.md` / `AGENTS.md`), not here. Cross-cutting E2E suites run in
CI or pre-release — they are NOT part of the per-change TDD loop.

## Changelog

- v3 (2026-08-08, retro-0016): added [TD7] — a guard must be proven in BOTH directions
  (a paired false-positive test), thresholds must be measured rather than inferred from a
  handful of observations, and a negative test must confirm its mutation actually landed
  before "it blocked" counts. From sig-0006 (a contamination guard that would have rejected
  any review quoting `</div>`), sig-0008 (a rule calibrated from 2 samples that, measured over
  80 runs, was right in kind and wrong in degree — it discarded correct answers on a third of
  realistic inputs), and sig-0014 (a mutation test whose patch never applied, which nearly
  recorded "the gate fails to block" from a no-op). Distinct from TD6: those tests existed,
  they just did not prove enough. **Contribution candidate** — generic to any project.
- v2 (2026-07-13, retro): added [TD6] — exercise the real/unseeded production path; a
  convenience-seeded fixture must not be the only path tested; assert through the real consumer,
  not a proxy that can pass for the wrong reason; on delegated/generated code a fresh-context
  review of the real path is load-bearing. **First earned receipt** — contributed upstream from
  the Two Way Invoice Sync dogfood (Retro 0002), where a fresh-context review caught a real
  (usually money-correctness) bug in EVERY delegated phase, root cause always "tests green for
  the wrong reason" (Two Way Invoice Sync signals `sig-0006` NaN-via-toEqual and `sig-0009` the
  meta-pattern — external to this repo's own log, cited via the contribution direction, not
  seeded here). The loop's contribution direction working: a real project's signals amended the
  canonical skill.
- v1 (2026-07-09, init): generated from the ChytaPay `tdd-discipline` skill. Stripped
  ChytaPay-specifics (sdd-triage/apply/init machinery, `strict_tdd` forwarding, repo paths,
  ARS/USD). Kept the strict/light/off levels, the RED→GREEN→TRIANGULATE→REFACTOR cycle, and
  behavior-first naming. KEY transform: money/cents demoted from a hard-coded core rule to a
  WORKED EXAMPLE of a `strict` path that the project's constitution defines. No signal
  receipts yet — those accrue as the retro loop runs. Reformatted to SPEC §3.3: consolidated
  TD1–TD5 into a single `## Rules` list; clarified that strict-path classification is done by
  the project's triage rules operationalizing the constitution's risk profile, not by the
  constitution directly.
