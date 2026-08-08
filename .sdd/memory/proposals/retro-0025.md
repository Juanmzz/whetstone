# Retro proposals

Signals sig-0017 … sig-0025 (9 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .sdd/skills/xreview.md

**Extend XR5 with two more "grounding" corollaries: presence-of-a-field isn't substance, and a negative control must be isolated from real work so undoing it can't destroy anything else.**

XR5 already learned (v2, retro-0016) that a check's RESULT must be grounded — confirm the mechanism actually ran before trusting what it reports. sig-0021 shows that fix working exactly as intended, one level removed from a new failure. The two live gaps in this cluster are corollaries of the same "shallow signal mistaken for real validation" pattern XR5 already owns, not a new mechanism: sig-0018 is a validator that checked a rationale was non-empty instead of substantive, so a placeholder passed as if it were an answer. sig-0025 is the mirror case in git: a deliberate negative control (breaking a test to prove the pre-push hook blocks it) was staged together with real work via `git add -A`, so reverting the defect via `git reset --hard` destroyed real work too — the "control" wasn't isolated enough to undo safely. Both are best fixed as text in the rule that already exists for this exact failure mode (XR5's grounding bullets) rather than a new hook or command: sig-0018's fix was a code change (validator now rejects placeholders/TBD/<60 chars) that has no corresponding rule text yet, and sig-0025 has no rule at all describing the git-hygiene precondition for running a negative control safely. A rule beats a hook here because both are process discipline for a human/agent setting up or accepting verification evidence, not something a deterministic gate can enforce.

- cluster: `rule:skills/xreview.md`
- receipt: `sig-0018`, `sig-0025`

### Proposal 2 — amend: .sdd/skills/delegation.md

**Add a sub-clause to [D7] distinguishing hermetic judges from tooled crewmates: D7's "artifact references as ids/paths, not full content" only holds for a delegate that HAS tools to fetch. A hermetic judge (no filesystem/tool access — e.g. the retro proposer) cannot resolve a path, so anything it must judge has to be inlined as full content in the prompt.**

sig-0017's root cause is a literal contradiction inside D7 as written: it prescribes "ids/paths, not full content — the sub-agent fetches them itself" as a universal rule, but that clause silently assumes the delegate has tools. The retro proposer doesn't (it's a judge, by design), so it was handed a path to a skill file it could never open and returned 'placeholder' for 3 of 4 proposals. The fix that actually worked (per the signal) was inlining the target's current content and the real skill list into the prompt — i.e. treating judges as a distinct case from crewmates, which D7 doesn't currently do. This is a one-clause amendment, not a new rule: D7 already gestures at the right idea for crewmates, it just needs the judge exception made explicit so the next hermetic-judge prompt doesn't repeat the mistake.

sig-0025 (the git reset --hard incident) is in the same cluster but doesn't ground a change to delegation.md — its root cause is "don't stage a deliberate defect with -A alongside real work," which is a git-hygiene/verification-practice lesson, not a delegation-prompt-contract lesson. It doesn't share a fix with sig-0017 and forcing it in would produce an unearned rule, so it's left out of citedSignals here.

- cluster: `rule:skills/delegation.md`
- receipt: `sig-0017`

### Proposal 3 — amend: .sdd/skills/delegation.md

**Add an explicit invariant to the delegation skill: any adapter that spawns a subprocess must parse stdout for a complete envelope before treating a non-zero exit as an unrecoverable spawn failure.**

sig-0022 is a single-signal cluster and the underlying bug in shell/claude.ts is already fixed and tested (commit f0431eb), so there is nothing left to repair there. What is not yet covered is the fact that shell/crewmate.ts shares the exact same shape: it spawns a subprocess whose CLI can exit non-zero on a terminal error while still writing a complete, parseable envelope to stdout. Without an explicit rule, the next person to touch the delegation path (or add a new adapter) can reintroduce the identical failure mode: execFile rejects, stdout gets discarded, and a structured error (budget/auth/timeout) gets silently downgraded into an opaque 'spawn' failure — exactly the distinction AGENTS.md hard rule 3 says must never be collapsed. Delegation.md is the skill that governs this exact subprocess-boundary, so it's the smallest, most on-topic place to pin the invariant rather than writing a new skill or guessing at an ADR I can't verify the filename of. This is a preventive amendment, not a fix — the rationale should be read as guarding the pattern going forward, not remediating sig-0022 itself.

- cluster: `type:error-detail-lost-at-adapter`
- receipt: `sig-0022`

### Proposal 4 — amend: .sdd/skills/xreview.md

**Add a review checklist item: any "walk up the directory tree until X is found" lookup must have an explicit ownership boundary (stop at the owning package.json, never cross node_modules) — flag it in review if it doesn't.**

sig-0020 is a single signal, but it describes a bug that shipped undetected through review: findPayloadRoot() walked up unbounded from the installed module location and, once nested under a target's node_modules, would find and copy the TARGET's own .sdd/skills back onto itself — reporting success while doing the opposite of init's job. The bug was fixed and regression-tested with a simulated install, so the code is already safe. What's missing is that the review process had no reason to catch this class of bug before it landed — "walk up until found" lookups are a recognizable anti-pattern (no notion of ownership, silently returns someone else's artifact when embedded inside their tree) that will recur anywhere Whetstone does directory-tree search (payload root, config discovery, monorepo root detection). A checklist line in xreview.md is the smallest fix: it costs nothing to run, doesn't require a static-analysis hook, and puts the burden on the one place code changes are already being read — review — rather than inventing new tooling for a single incident.

- cluster: `type:payload-lookup-escapes-package`
- receipt: `sig-0020`

## Dropped by the anti-poisoning gate

- **.sdd/skills/doc-locations.md** — its rationale is a placeholder — the proposer had nothing to say; its summary is a placeholder
