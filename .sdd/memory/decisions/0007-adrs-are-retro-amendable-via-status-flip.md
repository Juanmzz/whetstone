---
id: adr-0007
ts: 2026-07-14
status: accepted
supersedes: null
rules_affected: ["retro.md"]
---
# ADRs are retro-amendable via status flip, never by editing prose

## Context

`retro.md` step 3/6 already assumes the retro can "flip an ADR (set `status: superseded`)", but
`OPEN_QUESTIONS.md` #2 still listed *"Are decisions retro-amendable?"* as unresolved. The crossed
review (SPEC-alignment judge) flagged that a procedure had operationalized an answer to an open
governance question without a decision — a slip against the project's own human-gated ethos
(ADR-0003). This ADR closes the question.

## Decision

- **Yes — ADRs are retro-amendable, but only by `status` transition, never by editing accepted
  prose.** The retro may propose flipping an ADR's `status` (`proposed → accepted`, or
  `accepted → superseded`) and, on supersession, writing a NEW ADR that references it. The old
  ADR's Context/Decision/Consequences text is immutable — the audit trail is the point.
- **Human-gated, always** (ADR-0003). The retro DETECTS and PROPOSES the flip; the human confirms
  before any `status` change lands. Same gate as every other retro write.
- **The `constitution.md` remains exempt** (SPEC §3.1) — the retro never touches it, by status or
  otherwise. ADRs are decisions-with-alternatives and can be overtaken by evidence; the
  constitution is the human-owned root.

## Consequences

- `retro.md` step 6's "Flip an ADR" is now backed by a decision, not an assumption.
- `OPEN_QUESTIONS.md` #2 is resolved and removed from the open list (this ADR is its answer).
- A superseded ADR stays on disk with `status: superseded` and a pointer forward; nothing is
  deleted, mirroring the append-only spirit of the signal log.
