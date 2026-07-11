---
id: tdd-discipline
version: 1
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

- v1 (2026-07-09, init): generated from the ChytaPay `tdd-discipline` skill. Stripped
  ChytaPay-specifics (sdd-triage/apply/init machinery, `strict_tdd` forwarding, repo paths,
  ARS/USD). Kept the strict/light/off levels, the RED→GREEN→TRIANGULATE→REFACTOR cycle, and
  behavior-first naming. KEY transform: money/cents demoted from a hard-coded core rule to a
  WORKED EXAMPLE of a `strict` path that the project's constitution defines. No signal
  receipts yet — those accrue as the retro loop runs. Reformatted to SPEC §3.3: consolidated
  TD1–TD5 into a single `## Rules` list; clarified that strict-path classification is done by
  the project's triage rules operationalizing the constitution's risk profile, not by the
  constitution directly.
