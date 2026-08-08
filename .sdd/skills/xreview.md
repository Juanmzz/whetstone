---
id: xreview
version: 3
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
   strict/high-stakes paths defined in `triage-rules.md`, which operationalizes the
   constitution's risk profile) — not hard-coded here. Trivial changes skip it.
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
   - **Ground the verification itself, not only the claim.** The same failure recurs one level
     up, in the reviewer's own process. Before a check's result counts as evidence: confirm the
     check ran and did what it claims. A negative control must be confirmed to have *landed* and
     *flipped* the result; otherwise a green run is indistinguishable from a broken test.
   - **State which state you looked at.** A diagnosis drawn from an artifact that a cleanup step
     has already reset is worthless, and worse, it looks authoritative. Say whether the evidence
     is live or post-cleanup *before* drawing a conclusion from it.
   - **Presence of a field is not substance.** A validator that checks only that something is
     non-empty will forward a non-answer. "The model said something" and "the model answered"
     are different results, and only one of them is evidence.
   - **Isolate a negative control from real work.** When you deliberately break something to
     prove a check catches it, keep that defect as the ONLY uncommitted change. Sweeping it up
     with real work means undoing it destroys the work too, and you will not notice until
     something you were not watching changes.
6. [XR6] With multiple judges on the same finding, majority-refute kills it — treat it as a
   false positive unless the grounding step (XR5) finds otherwise.
7. [XR7] Escalate panel size with stakes: one fresh-context judge for a standard strict-path
   change; more independent judges (additional sub-agents, or a human-relayed external model)
   for changes with wide blast radius.
8. [XR8] Optional fix-loop: fix → re-judge only the touched findings → stop after 2 rounds.
   Never loop unbounded chasing a clean panel.

## Review checklist

Things worth looking for specifically, because they read as correct and are not:

- **An unbounded "walk up the tree until X is found" lookup.** It has no notion of ownership.
  Shipped inside someone else's directory tree it will happily find THEIR X and report success.
  Every such walk needs an explicit boundary: stop at the file that identifies the owner, and
  never cross a dependency directory.

## Anti-patterns

- Asking the judge to confirm instead of refute — produces a rubber stamp, not a review.
- Reusing the author's context/session as the "independent" judge.
- Relaying a judge verdict without grounding it against the actual code.
- Treating a single judge's pass as final on a wide-blast-radius change.

## See also

[[tdd-discipline]] TD6 — the same fresh-context-catches-real-bugs lesson, applied to
per-phase review during implementation rather than pre-merge judgment.

## Changelog

- v3 (2026-08-08, retro-0025): two more [XR5] corollaries, and a review-checklist
  section. Presence of a field is not substance: a validator checking only for non-empty
  will forward a non-answer, and "the model said something" is not "the model answered"
  (sig-0018, where the retro's own gate passed proposals whose entire body was the word
  "placeholder"). Isolate a negative control from real work: a deliberate defect must be
  the ONLY uncommitted change, or undoing it destroys the work it was staged with
  (sig-0025, where a `git reset --hard` to remove planted sabotage also removed the
  pre-push hook, the CI workflow and two source changes). The checklist adds the
  unbounded directory walk: a "walk up until X is found" lookup has no notion of
  ownership and, shipped inside someone else's tree, finds THEIR X and reports success
  (sig-0020). **Contribution candidates** — all three are generic.
- v2 (2026-08-08, retro-0016): extended [XR5] reflexively — ground the VERIFICATION, not
  only the claim, and state whether the evidence is live or post-cleanup before concluding
  from it. From sig-0003 and sig-0004 (API assumptions asserted without checking the docs),
  sig-0008 (a rule generalised from 2 samples), sig-0014 (a negative control that silently
  no-op'd), and sig-0016 (a confident diagnosis drawn from a worktree that the cleanup step
  being audited had already reset). XR5 already covered the judge's verdict; these show the
  same gap one level up, in the reviewer's own process. **Contribution candidate.**
- v1 (2026-07-13, init): generated from the ChytaPay `chyta-xreview` skill. Stripped the
  hard-coded vendor CLIs (Gemini/Codex), the vendor probe/registry machinery, and the
  ChytaPay data-boundary/plugin specifics. Kept the core discipline: independent judge,
  fresh context, refute-not-confirm framing, grounding every verdict, majority-refute
  kills a finding. Generalized the judge mechanism to fresh-context sub-agent (default) or
  external model (optional, project-configured) and moved escalation triggers to the
  project's own triage rules instead of hard-coding them. No signal receipts yet.
