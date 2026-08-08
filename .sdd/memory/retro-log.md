# Retro log

Append-only record of every retro run (SPEC §3.4). Each entry marks the signal cursor so
the next run knows what "since last retro" means.

## retro-0016 — 2026-08-08

cursor: sig-0016

**Trigger:** first run of `wst retro` as CODE. Sixteen signals had accumulated, thirteen of
them generated while building the engine itself.

**Signals read:** `sig-0001` … `sig-0016` (16). Clustered into 10, of which 5 were actionable.
The three strongest clusters formed on `rule_affected`, which is the axis the procedure calls
strongest and the implementation now protects from being swallowed by a broad `type:` bucket.

**Applied (4 of 5 proposals):**

| Rule | Change | Receipt |
|---|---|---|
| `tdd-discipline` v2→v3 | **[TD7]** a guard must be proven in BOTH directions; thresholds measured not inferred; a negative test must confirm its mutation landed | sig-0006, sig-0008, sig-0014 |
| `xreview` v1→v2 | **[XR5]** extended reflexively — ground the verification itself, and state whether evidence is live or post-cleanup | sig-0003, sig-0004, sig-0008, sig-0014, sig-0016 |
| `voice` v1→v2 | **[V2]** extended — covers sub-agent/tool output, and requires stating the SCOPE of a verification | sig-0003, sig-0004, sig-0009, sig-0016 |
| `delegation` v1→v2 | **[D8]** verify a delegate against the base captured before dispatch; refuse an empty result; never merge "no checks ran" into "all checks passed" | sig-0015 |

`resolved_by` set on the eight signals these amendments answer.

**Declined (1):** the proposal for `type:broken-tool-read-as-failure` (sig-0013) recommended
against itself — one already-fixed signal, and `tdd-discipline` is the wrong home for a
subprocess-exit-code convention. Its own text offered "not to act at all" as the alternative,
and that is what was chosen. A retro that declines is working correctly.

**Contribution candidates (ADR-0006):** all four amendments. None is Whetstone-specific — they
are about guards, verification, delegation and honesty in reporting, and would help any project.

**Consciously deferred:** the six single-signal `type:` clusters below the actionable bar
(`build-before-validate`, `filtered-run-reads-as-global`, `lens-prompt-shapes-verdict`,
`calibration-passed`, and the `token-economy` cluster). Recurrence is the trigger; a lone
non-high signal waits for the next retro.

**What this run says about the retro itself:** it exposed three defects in its own
implementation before producing anything useful — a hermetic proposer asked to amend files it
had never been shown (`sig-0017`), a gate that forwarded a model's "I cannot do this" as a
valid proposal (`sig-0018`), and cluster duplication that would have paid for nine LLM calls to
hand the human five duplicates. The first run produced three proposals whose entire body was
the word "placeholder". The second, after fixes, produced five substantive ones. Worth
remembering the next time this output looks authoritative.

**Prior retros:** Retro 0001–0002 ran on the Two Way Invoice Sync take-home, external to this
repo, and produced TD6. This is the first retro on Whetstone's own signals, and the first run
by code rather than by hand — N=2 for the loop, N=1 for the engine.
