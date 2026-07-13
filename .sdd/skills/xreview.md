---
id: xreview
version: 1
status: active
---
# Adversarial review (xreview)

Before accepting a high-stakes change, get an independent judge to try to **refute** it —
not confirm it. Confirmation bias is the failure mode: an author (human or agent) reviewing
their own work shares its blind spots.

## Core principle

The reviewer's job is to find the failure, not bless the work. A judge asked "does this look
OK?" rubber-stamps. A judge asked "what's wrong with this?" finds things.

## Rules

1. [XR1] Which changes require adversarial review is set by the project's triage rules (the
   strict/high-stakes paths defined in the constitution or `wst.yaml`) — not hard-coded here.
   Trivial changes skip it.
2. [XR2] The judge must run in **fresh context** — no shared assumptions, reasoning, or
   conversation history with the author. Shared context defeats the purpose even if the judge
   is nominally a different model.
3. [XR3] A fresh-context sub-agent is the default, always-available judge. An external model
   is an optional additional judge ONLY if the project has one configured and approved for the
   content being reviewed — never assume or hard-code which vendor.
4. [XR4] Frame every judge brief as an instruction to refute: per-finding verdict
   `REAL / FALSE_POSITIVE / UNCERTAIN` plus an open hunt for gaps the author missed. Never
   frame it as a yes/no approval ask.
5. [XR5] Ground every verdict against the real code before accepting or rejecting it — an
   unverified judge opinion (agent's or human's) is worth zero. The orchestrator, not the
   judge, owns the final call.
6. [XR6] With multiple judges on the same finding, majority-refute kills it — treat it as a
   false positive unless the grounding step (XR5) finds otherwise.
7. [XR7] Escalate panel size with stakes: one fresh-context judge for a standard strict-path
   change; more independent judges (additional sub-agents, or a human-relayed external model)
   for changes with wide blast radius.
8. [XR8] Optional fix-loop: fix → re-judge only the touched findings → stop after 2 rounds.
   Never loop unbounded chasing a clean panel.

## Anti-patterns

- Asking the judge to confirm instead of refute — produces a rubber stamp, not a review.
- Reusing the author's context/session as the "independent" judge.
- Relaying a judge verdict without grounding it against the actual code.
- Treating a single judge's pass as final on a wide-blast-radius change.

## See also

[[tdd-discipline]] TD6 — the same fresh-context-catches-real-bugs lesson, applied to
per-phase review during implementation rather than pre-merge judgment.

## Changelog

- v1 (2026-07-13, init): generated from the ChytaPay `chyta-xreview` skill. Stripped the
  hard-coded vendor CLIs (Gemini/Codex), the vendor probe/registry machinery, and the
  ChytaPay data-boundary/plugin specifics. Kept the core discipline: independent judge,
  fresh context, refute-not-confirm framing, grounding every verdict, majority-refute
  kills a finding. Generalized the judge mechanism to fresh-context sub-agent (default) or
  external model (optional, project-configured) and moved escalation triggers to the
  project's own triage rules instead of hard-coding them. No signal receipts yet.
