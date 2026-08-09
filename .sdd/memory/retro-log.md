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

## retro-0025 — 2026-08-08

cursor: sig-0025

**Trigger:** nine signals accumulated since retro-0016, all generated while finishing Steps 4
through 7 and hardening the gate.

**Signals read:** `sig-0017` … `sig-0025` (9). Eight clusters, five actionable.

**Applied (3 of 4 proposals):**

| Rule | Change | Receipt |
|---|---|---|
| `xreview` v2→v3 | Two more [XR5] corollaries (presence of a field is not substance; isolate a negative control from real work) plus a review-checklist section on unbounded directory walks | sig-0018, sig-0020, sig-0025 |
| `delegation` v2→v3 | [D7] gains the hermetic-delegate case: paths only work for a delegate that has tools | sig-0017 |

The `delegation` amendment is the most useful thing this retro produced, because it did not
just record a mistake, it found that **an existing rule was the cause of one**. D7 said to pass
artifact references as paths rather than content, on the reasoning that the sub-agent fetches
them itself. That silently assumed the delegate has tools. A hermetic judge cannot resolve a
path, so D7 as written guaranteed the failure in `sig-0017`. The rule was not an innocent
bystander.

**Declined (1 of 4):** a proposal to add a subprocess-exit-code convention (parse stdout for a
complete envelope before treating a non-zero exit as a spawn failure) to `delegation.md`. Single
signal, already fixed in code, and delegation is about handing work to sub-agents rather than
about adapter plumbing. Same shape as the proposal declined in retro-0016, except this one did
not flag its own weakness. The convention is real and worth having; `delegation.md` is not its
home, and no skill currently is.

**Dropped by the anti-poisoning gate (before reaching a human):** one proposal targeting
`doc-locations.md` whose summary and rationale were both the word "placeholder". That gate was
added in retro-0016 in response to `sig-0018`. It caught its first live case here, one retro
after being written.

**Contribution candidates (ADR-0006):** both amendments.

**Consciously deferred:** three single-signal `type:` clusters below the actionable bar
(`error-detail-lost-at-adapter`, `lens-never-runs-on-real-diffs`, `payload-lookup-escapes-package`)
whose lessons are partly captured by the amendments above, plus `spec-itself-violates-its-adr`.

**Observation worth carrying forward:** of the nine signals in this window, four
(`sig-0021`, `0024`, `0025`, and arguably `0018`) are mistakes made while VERIFYING work, not
defects in the work itself. The engine's own output has been more reliable than the process used
to check it. That is the cluster to watch next time.
