---
id: lazy
version: 1
status: active
---
# Lazy = efficient, not careless

The best code is the code never written. This is the **proactive** stance — applied
*before* you write, not the reactive cleanup pass that follows after.

## The ladder — stop at the first rung that holds

Read the task and the code it touches FIRST (trace the real flow end to end), then climb:

1. [L1] **Does this need to exist?** Speculative need → skip it, say so in one line. (YAGNI)
2. [L2] **Already in this codebase?** A helper / util / type / pattern that already lives
   here → reuse it. Re-implementing what's a few files over is the most common slop.
3. [L3] **Stdlib does it?** Use it.
4. [L4] **Native platform feature covers it?** A DB constraint over app code, CSS over JS,
   a built-in form control over a picker library.
5. [L5] **An already-installed dependency solves it?** Use it. Never add a NEW dependency
   for what a few lines do.
6. [L6] **Can it be one line?** One line.
7. [L7] **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. The first lazy solution that works is
the right one — *once you actually understand what the change has to touch.*

## Rules

- [L8] **No unrequested abstractions:** no interface with one implementation, no factory
  for one product, no config for a value that never changes. No scaffolding "for later" —
  later can scaffold for itself.
- [L9] **Deletion over addition.** Fewest files. Shortest working diff — but only after you
  understand the problem (the smallest change in the wrong place is a second bug, not
  laziness).
- [L10] **Bug fix = root cause, not symptom.** Grep every caller of the function you're about
  to touch; one guard in the shared function is a smaller, more correct diff than a guard in
  each caller.
- [L11] **Mark a deliberate simplification with a plain why-comment** naming the ceiling +
  upgrade path — this IS the "comment the why" discipline, NOT a traceability tag (no
  prefixes): `// global lock for now; per-account locks if throughput matters`.

## When NOT to be lazy (worked example)

The constitution's risk profile names the domains where correctness is non-negotiable; never
simplify away correctness at trust boundaries, error handling that prevents data loss,
security, or accessibility in those domains. WHICH domains are non-negotiable is set by the
project's constitution and triage rules, not hard-coded here. Example — a payment system's
constitution might name money handling (integer cents, see `tdd-discipline.md`) and
auth/multi-tenant filtering as such domains. Another project's list might be different
entirely. "Lazy" stops exactly where the constitution says correctness begins.

## Output

Code first. Then at most one line: `skipped: <X>, add when <Y>.` If the explanation is
longer than the code, delete the explanation — prose defending a simplification is just
complexity smuggled back in.

## Changelog

- v1 (2026-07-13, init): generated from the ChytaPay `chyta-lazy` skill (adapted from
  ponytail, github.com/DietrichGebert/ponytail, MIT). Stripped the payment-system
  NON-NEGOTIABLE exceptions (money/cents, multi-tenant, PCI, auth) as hard-coded rules,
  along with repo names and chyta plugin machinery. Kept the YAGNI ladder (L1–L7), the
  proactive "does this need to exist?" discipline, and the no-abstractions /
  deletion-over-addition / root-cause / why-comment rules (L8–L11). Generalized the
  exceptions section into a worked example: non-negotiable domains are named by the
  project's constitution and triage rules, not hard-coded in this skill. No signal
  receipts yet.
