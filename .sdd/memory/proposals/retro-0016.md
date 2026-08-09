# Retro proposals

Signals sig-0001 … sig-0016 (16 new).
**Nothing here has been applied.** Approving is a human act.

### Proposal 1 — amend: .sdd/skills/tdd-discipline.md

**Add [TD7]: a blocking guard/validator needs a paired false-positive test and, if its threshold is example-derived, calibration against a measured sample — plus, negative/mutation tests must first confirm the mutation actually landed before trusting a "blocked" verdict.**

Three signals in this cluster share a root cause distinct from what TD1-TD6 already cover: they're not about missing tests before implementation, they're about tests that exist but don't prove enough. sig-0006's contamination guard was tested against garbage but never against a legitimate false-positive case (an HTML review quoting `</div>`), so it would have failed closed on real work. sig-0008's guard was then calibrated to reject ALL tool-call markup from a 2-sample observation, when the real, measured failure shape (80 calibration runs) was narrower — degree, not kind, was wrong, and it cost 3 billed retries before re-measurement caught it. sig-0014 is the mirror failure on the other side: a negative/mutation test that never verified its own mutation landed, which would have reported "the gate fails to block" from a no-op patch. All three are the same gap: a guard/negative-test is trusted on the strength of what it rejects, without a check that it (a) still accepts legitimate input and (b) was calibrated or self-verified against real, measured cases rather than a hand-picked example or an unconfirmed mutation. I did not fold sig-0005 or sig-0012 into this change — both are already covered by the existing TD6 corollary ("assert through the real consumer, not a proxy that can pass for the wrong reason"), so citing them here would be padding evidence for a rule they don't motivate. A rule-text amendment is the smallest fix: this is a test-design habit for anyone writing a guard, not a mechanically enforceable property, so a hook or script isn't the right apparatus.

- cluster: `rule:skills/tdd-discipline.md`
- receipt: `sig-0006`, `sig-0008`, `sig-0014`

### Proposal 2 — amend: .sdd/skills/xreview.md

**Extend XR5's grounding principle reflexively to the verifier's own acts: before trusting a test/diagnostic result, confirm the verification mechanism itself actually did what it claims — a negative-control mutation must be confirmed to have landed and flipped the result before a pass counts as meaningful, and a diagnosis must state which state (live vs. post-cleanup) its evidence was drawn from. Add two anti-pattern entries for these failure shapes.**

All 5 signals in this cluster are the same failure shape at different scopes: an unverified claim was trusted until it was checked against real, live evidence. sig-0003 and sig-0004 show it at the API-assumption layer (caught by docs/live probing); sig-0008 shows it at the calibration layer (a guard rule generalized from 2 samples, fixed by measuring 80 real runs). XR5 already codifies this for the *judge's verdict*. But sig-0014 and sig-0016 show the identical failure recurring one level up, in the verifier's own process, which XR5 as written doesn't cover: sig-0014 nearly recorded 'the gate fails to block' because the negative-control mutation silently no-op'd and nobody checked the test actually went red first; sig-0016 diagnosed a false 'branched from wrong commit' conclusion from a worktree that `treehouse return --force` had already wiped, i.e. drew a conclusion from evidence destroyed by the very cleanup step being audited. Both are XR5's grounding gap turned inward — the reviewer trusted its own check without grounding the check itself. Smallest fix is a textual extension of XR5 plus two anti-pattern entries, not a new rule number or a new skill.

- cluster: `rule:skills/xreview.md`
- receipt: `sig-0003`, `sig-0004`, `sig-0008`, `sig-0014`, `sig-0016`

### Proposal 3 — amend: .sdd/skills/voice.md

**Extend V2 ("Verify before agreeing") to require stating the SCOPE of a verification, not just that one happened: which state was checked (current vs. possibly stale/cleaned-up), and how much evidence backs a stability/fix claim (sample size, input size). Also make explicit that V2 covers sub-agent/tool output, not only the human's or the agent's own claims.**

Four signals on this rule are all verification failures, but they fail in three distinct ways V2's current wording doesn't reach: sig-0003 and sig-0004 are the case V2 already targets (unverified claim shipped) — sig-0003's own lesson explicitly says "V2 applies to sub-agent output too," which the rule text doesn't yet say. sig-0009 is a claim that WAS verified but on unrepresentative evidence (2 runs, short input) and then asserted as a general fix — V2 says "check first," but doesn't require disclosing how much checking. sig-0016 is a conclusion drawn from state that looked current but had already been altered by cleanup — a verification step happened (inspecting the worktree) but against the wrong artifact, and the conclusion was announced before stating what was being looked at. A single "check before you answer" rule doesn't stop either failure mode; the fix is requiring the verification's scope and target state to be stated alongside the conclusion, which is the smallest change that closes all three gaps without adding a new rule.

- cluster: `rule:skills/voice.md`
- receipt: `sig-0003`, `sig-0004`, `sig-0009`, `sig-0016`

### Proposal 4 — amend: .sdd/skills/tdd-discipline.md

**No change justified from this cluster — the fix already shipped in code (gate maps 126/127 to `errored` before exit-code inspection), and one high-severity but already-resolved signal doesn't warrant a new rule; smallest possible touch is a one-line addendum flagging the pattern for future check/exec code.**

sig-0013 is a single signal, and its own text records that the gate lane already fixed the root cause (126/127 exit codes are now checked before the exit-status branch and mapped to `errored` rather than a failing check). That's the fix in the actual execution path, not process guidance — no skill, hook, or ADR gates *how* future shell-exec code gets written, so nothing here would have caught a repeat of this mistake in a different command. Given it's one signal and the concrete bug is already patched, I don't think this cluster clears the bar for a new rule or hook: a hook can't statically verify "did you separate tool-failure from code-failure," and a full skill is disproportionate to one occurrence. The closest fit is `tdd-discipline.md` since it's the skill governing how checks are implemented/verified (`errored` vs `failing` is exactly a test-correctness distinction), but I'm flagging this as a borderline case — the smallest defensible amendment is a single line noting that shell-exec checks must distinguish tool failure (missing binary / bad exit like 126/127) from code failure (the check's actual verdict), pointing at sig-0013 as the precedent. If this doesn't feel like the right home, the alternative is not to act at all and instead let this stay a one-off code fix.

- cluster: `type:broken-tool-read-as-failure`
- receipt: `sig-0013`

### Proposal 5 — amend: .sdd/skills/delegation.md

**Add a rule that any gate/verification step following a delegated crewmate's work must scope the diff to the base commit captured before dispatch (never working-tree-vs-HEAD), must refuse when the crewmate committed nothing, and must never let 'no checks ran' share a success message with 'all checks passed'.**

sig-0015 shows `wst run` gating with --range HEAD against a working tree the crewmate had already committed into, producing an empty diff — the gate correctly reported nothing was verified, but `wst run` still printed PASSED above it, collapsing two distinct outcomes into one success signal. The code fix (capture base pre-dispatch, gate base..HEAD, refuse on empty commits) is already noted as applied in the signal itself, so the remaining root cause is that this is a general delegation-workflow invariant, not a one-off bug: any future dispatch-then-gate flow can reintroduce the same ambiguity if the rule isn't written down where delegation is designed. delegation.md is the smallest apparatus — a rule there, not a new skill or hook — since the crewmate-dispatch-then-gate sequence is exactly its subject matter. Single-signal cluster, so this is a narrow, targeted amendment rather than a broad policy change.

- cluster: `type:gate-verified-nothing`
- receipt: `sig-0015`
