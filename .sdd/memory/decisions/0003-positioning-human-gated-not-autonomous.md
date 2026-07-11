---
id: adr-0003
ts: 2026-07-06
status: accepted
supersedes: null
rules_affected: []
---
# Position as human-gated auditable evolution, explicitly not autonomous optimization

## Context

A bounded prior-art check (2026-07-06) evaluated whether Whetstone's thesis is already
occupied. Finding: **no exact match** for the combination of signal-sourced +
human-gated + audit-trailed amendment of human-readable workflow rule files. The closest
shipping product is **Cursor Bugbot**, which learns from PR-review signals — but it is
autonomous (no human gate on proposals), closed to Cursor, UI-managed (rules not in git),
and carries no rule→signal provenance. Adjacent-but-different categories: forward-path
spec frameworks (Spec Kit, BMAD, Superpowers), RAG memory layers (mem0, Letta, Zep), and
autonomous optimizers (DSPy, Reflexion).

The verdict was **go on novelty** — but novelty ≠ value. The only credible "competitor" to
the manual approach is a blog post telling teams to do this by hand, which cuts both ways.

## Decision

- Lead positioning with: **human-gated proposals + signal receipts + git-native +
  cross-tool**. These are the differentiators against the three likely dismissals
  ("just Bugbot", "we do it manually", "DSPy already does this").
- **Reaffirm the non-goal:** no autonomous rule rewriting. The human gate is the moat, not
  a limitation. This locks in the VISION.md anti-scope.
- Treat novelty as necessary-but-not-sufficient. Value is **unproven** and will be decided
  by dogfooding, not by market gap.

## Consequences

- The README/pitch leads with auditability over autonomy.
- **Kill criterion (pre-registered):** after dogfooding the full loop on one real project,
  if the retro proposes nothing a human actually wants to accept — nothing that beats doing
  it ad hoc — the thesis has failed and the project should be reconsidered or shelved. This
  is the falsifiable test, recorded now so it can't be rationalized away later.
- Public release, npm, and repo ceremony stay gated behind that dogfooding result.
