# Retro proposals

Signals sig-a9ff00c4 … sig-6406e533 (5 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .wst/hooks/docs-fresh.md

**Change the docs-fresh gate from check-only to check-and-fix: have it regenerate the AGENTS.md status line counts (ADRs, signals, commands) automatically rather than just failing when they drift.**

Two separate gate-blocked events (sig-a9ff00c4, sig-5c2d6751) are the same root cause recurring: the AGENTS.md status line hardcodes counts that are trivially derivable ("every number in it is one command away"), and it drifts every time an ADR or signal is added. The gate version bumped between the two incidents (v1 → v3), meaning a prior fix attempt already happened and the problem still recurred — that's evidence a manual reminder (skill/rule) isn't sufficient, since the failure mode is purely mechanical bookkeeping, not a judgment call an agent needs to be taught. The cheapest fix that eliminates the whole class of error is to have the gate compute and write the correct numbers itself instead of only asserting they're correct. I excluded sig-6f2d2b95 from this cluster's fix — it's a `test` gate failure about a fake-bin write error (ENOSYS/-122), an unrelated root cause (looks like a sandboxed tmpdir/fs issue), and bundling it here would blur the fix; it likely needs its own investigation.

- cluster: `type:gate-blocked`
- receipt: `sig-a9ff00c4`, `sig-5c2d6751`

### Proposal 2 — amend: .wst/skills/tdd-discipline.md

**Add a changelog entry documenting the one-commit-per-change decision for TD1/TD2, since the rule text already reflects it but the change history doesn't record it.**

The cluster describes a rule that used to mandate separate RED and GREEN commits, got flagged three times, and was reintroduced once even after correction. But the CURRENT text already states the fix: TD1 says to keep (not commit) the red output as evidence, and TD2 explicitly says "One commit per coherent change, not one per phase — RED and GREEN land together, with the red output quoted in the commit body," with a rationale paragraph explaining why splitting them is harmful. So the rule text itself no longer produces the recurrence described in sig-e8dfefd0 — restating it would violate the instruction not to restate a rule the file already contains.

What IS missing is a changelog line for this decision. The Changelog section only documents v6 (TD9's addition); it says nothing about when/why the one-commit policy replaced the two-commit ceremony. That gap is exactly what let a review agent flag the absence of separate commits as a hard-rule-4 violation and let an assistant reintroduce them — without a dated, explicit record of "this was a deliberate owner decision after repeated pushback," anyone diffing against older history or a stale cached copy of this skill has no signal that the two-commit form was intentionally retired rather than accidentally dropped. Adding one changelog line closes that gap with the smallest possible apparatus: no new rule, no hook, no ADR — just making the existing decision legible in the one place (the changelog) built for exactly this purpose.

- cluster: `rule:skills/tdd-discipline.md`
- receipt: `sig-e8dfefd0`
