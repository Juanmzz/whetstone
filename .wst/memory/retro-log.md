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

**Prior retros:** Retro 0001–0002 ran on the invoice-sync-engine project, external to this
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

## retro-0049

cursor: sig-cb978aef · 24 signals · 9 clusters, 7 actionable · $0.7283

**Applied, 3 of 7.**

- `tdd-discipline` v4 — [TD8]: a claim about system behaviour is a hypothesis until a
  test would fail if it were false. Earned by `sig-4b3339fb` and by hard rule 9's
  asymmetry, documented at length in two files and untested until 2026-08-13.
- `delegation` v4 — [D8] extended: the exit code carries the same honesty obligation as
  the message, and both derive from one decision. [D9] added: a gate sharing a worktree
  with the worker uses a non-persisting receipt store.
- `doc-locations` v2 — [DL7]: prose describing the tool's own behaviour is part of the
  change that alters it, and a comment names evidence or points at a decision rather
  than re-arguing one.

**Rejected, and why it matters.** Proposal 6 targeted `voice.md`. The retro drafted the
amendment and then argued against its own draft: `voice.md`'s scope line says it governs
reply text only and excludes code comments, so neither `sig-0032` nor `sig-672d598d`
belongs to it. It was right. The content moved to `doc-locations` as [DL7]; the human
tagged `sig-672d598d` with the wrong rule when recording it.

**Discarded.** Proposal 7 proposed an ADR pinning the `hooksArmed` path fix. Already
fixed in PR #28, open at the time of this retro. The retro reads the signal log and
cannot see open pull requests — not an error, but the reason a single-signal proposal
about a live bug should be checked against the branch state before it is applied.

**Deferred, not rejected.** Proposals 1 (`xreview` — probe the judge's isolation rather
than configuring it) and 4 (`recording` — an ADR removing a subsystem must enumerate the
prose describing it) are both sound and both wanted evidence a reader could check in one
sitting. They stay for the next window rather than being applied unread.

## retro-0004

cursor: sig-6406e533 · 54 signals · 3 clusters, 2 actionable · $0.1825

**Applied.** Proposal 1 — `docs-fresh` gained `npm run fix:docs`, which writes the counts
instead of only asserting them. Two gate-blocked signals a day apart are the same root
cause, and the check version had already bumped once between them: a reminder is not the
fix for bookkeeping that is one file operation away. Narrowed on the way in — the gate
still only checks, because a fix running inside it would rewrite the tree after the commit
it was judging already existed, and in CI would write to a runner nobody keeps.

**Refused, already satisfied.** Proposal 2 asked for a changelog line in `tdd-discipline`
recording why the two-commit ceremony was retired, on the grounds that "the Changelog
section only documents v6". It does not: v5 (2026-08-14) carries that entry with
`sig-e8dfefd0` as its receipt — the same signal the proposal cites. The retro read the
rule text closely enough to refuse restating it, and then missed the changelog it was
proposing to write. Worth noting as a failure mode: a proposal's claim about what a file
lacks is checkable, and nothing checks it.

## retro-0005

cursor: sig-39f4aa1e · 61 signals · 5 clusters, 5 actionable · $0.2994

**Accepted 1 of 5.**

- **Proposal 1, accepted narrowed** as `tdd-discipline` [TD10]: done means `wst gate
  --no-lens` passed, not that the tests passed. The proposal named an `npm run verify` that
  does not exist, and a second command would be a second definition of verified. It also
  predates the plugin's Stop hook, which already runs the gate where it is installed, so the
  rule covers everywhere it is not.
- **Proposals 2 and 4, accepted as one.** They are the same proposal from one signal
  (`sig-ea119c62`) clustered under two keys, and neither noticed the other. A `PreToolUse`
  guard on destructive git commands is real work, filed rather than written here.
- **Proposal 3, refused.** It asked to document the calibration deadlock's manual workaround.
  PR #107 fixed the deadlock in code days earlier. The retro could not know: `sig-b828c2b1`
  carries no `resolved_by`.
- **Proposal 5, refused.** It says so itself: "expect this to be rejected". It came from a
  `calibration-passed` signal, and a success is not friction, so the cluster had nothing to
  propose and one was invented to fill it.

**What this retro taught, beyond its proposals.** Two of five were dead on arrival because the
loop cannot see what already shipped: one fix landed in code, the other in a hook. And one
signal produced two identical proposals under two cluster keys. `resolved_by` is what would
have prevented the first; nothing yet prevents the second.
